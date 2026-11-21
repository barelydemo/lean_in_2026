"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { audio as mixer } from "./audio/engine";

/** How the browser fallback voices each character (no ElevenLabs needed). */
const BROWSER_VOICE: Record<string, { pitch: number; rate: number; male: boolean; prefer: RegExp }> = {
  kenji: { pitch: 0.95, rate: 0.98, male: true, prefer: /reed|otoya|daichi/i },
  aiko: { pitch: 1.2, rate: 1.05, male: false, prefer: /sandy|kyoko|google|nanami/i },
  yumi: { pitch: 1.0, rate: 0.9, male: false, prefer: /kyoko|haruka|o-ren/i },
  hiroshi: { pitch: 0.9, rate: 0.92, male: true, prefer: /eddy|otoya|keita/i },
  emily: { pitch: 1.1, rate: 0.95, male: false, prefer: /shelley|flo|kyoko/i },
};
// Japanese system voices by gender (macOS, iOS, Windows, Chrome).
const MALE_VOICE = /otoya|hattori|ichiro|keita|eddy|reed|rocko|grandpa|daichi|male|男/i;
const FEMALE_VOICE = /kyoko|o-ren|ayumi|haruka|nanami|sayaka|flo|sandy|shelley|grandma|google|female|女/i;
const NATURAL_VOICE = /enhanced|premium|neural|natural|siri/i;

/** Chrome fills the voice list asynchronously; wait briefly the first time. */
let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;
function japaneseVoices(): Promise<SpeechSynthesisVoice[]> {
  const pick = () => speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("ja"));
  if (pick().length) return Promise.resolve(pick());
  voicesReady ??= new Promise((resolve) => {
    const done = () => resolve(pick());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
  return voicesReady;
}

/** Best voice for a character: matching gender, most natural-sounding first. */
function chooseVoice(voices: SpeechSynthesisVoice[], male: boolean, prefer?: RegExp) {
  const byGender = voices.filter((v) => (male ? MALE_VOICE : FEMALE_VOICE).test(v.name));
  const pool = byGender.length ? byGender : voices;
  const voice =
    (prefer && pool.find((v) => prefer.test(v.name) && NATURAL_VOICE.test(v.name))) ??
    (prefer && pool.find((v) => prefer.test(v.name))) ??
    pool.find((v) => NATURAL_VOICE.test(v.name)) ??
    pool.find((v) => v.localService) ??
    pool[0];
  return { voice, genderMatched: byGender.length > 0 };
}

export interface Speakable {
  id: number;
  speaker: string;
  jp?: string;
}

/**
 * Character voices. Uses the server's ElevenLabs audio when it works, and
 * falls back to the browser's own Japanese speech synthesis otherwise, so
 * characters always talk.
 */
export class VoicePlayer {
  private urls = new Map<number, Promise<string | null>>();
  private previewUrls = new Map<string, Promise<string | null>>();
  private current: HTMLAudioElement | null = null;
  /** Lines whose server audio failed (after a retry); only these use the browser voice. */
  private failed = new Set<number>();
  volume = 1;

  constructor(private useServer: boolean) {}

  setServer(enabled: boolean) {
    this.useServer = enabled;
  }

  prefetch(ids: number[]) {
    if (!this.useServer) return;
    for (const id of ids) {
      if (!this.urls.has(id) && !this.failed.has(id)) this.urls.set(id, this.fetchAudio(id));
    }
  }

  /** Server audio for a line, retried once; a failure only affects that line. */
  private async fetchAudio(id: number): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return URL.createObjectURL(await api.tts(id));
      } catch (e) {
        // 503 means the server has no voice configured at all.
        if (e instanceof ApiError && e.status === 503) {
          this.useServer = false;
          break;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    this.failed.add(id);
    this.urls.delete(id);
    return null;
  }

  /** Resolves when playback ends (or immediately if no voice is available). */
  async play(line: Speakable): Promise<void> {
    this.stop();
    let url: string | null = null;
    if (this.useServer && !this.failed.has(line.id)) {
      this.prefetch([line.id]);
      url = (await this.urls.get(line.id)) ?? null;
    }
    mixer.duck(true);
    try {
      if (url) await this.playUrl(url);
      else if (line.jp) await this.speakInBrowser(line);
    } finally {
      mixer.duck(false);
    }
  }

  /**
   * Plays a suggested Japanese phrase in Beginner Shadow Mode using the
   * character's native TTS voice from `story.toml` via `/tts/preview`,
   * falling back to the character's browser speech voice if server audio is off.
   */
  async preview(text: string, speaker = "aiko", course = "ja"): Promise<void> {
    this.stop();
    let url: string | null = null;
    if (this.useServer) {
      const key = `${course}:${speaker}:${text}`;
      if (!this.previewUrls.has(key)) {
        this.previewUrls.set(
          key,
          api
            .ttsPreview(text, speaker, course)
            .then((blob) => URL.createObjectURL(blob))
            .catch((e) => {
              if (e instanceof ApiError && e.status === 503) this.useServer = false;
              this.previewUrls.delete(key);
              return null;
            }),
        );
      }
      url = (await this.previewUrls.get(key)) ?? null;
    }
    mixer.duck(true);
    try {
      if (url) await this.playUrl(url);
      else await this.speakInBrowser({ id: 0, speaker, jp: text });
    } finally {
      mixer.duck(false);
    }
  }

  private playUrl(url: string): Promise<void> {
    const audio = new Audio(url);
    audio.volume = Math.min(1, this.volume * mixer.voiceVolume);
    this.current = audio;
    return new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.onpause = () => resolve();
      audio.play().catch(() => resolve());
    }).finally(() => {
      if (this.current === audio) this.current = null;
    });
  }

  private async speakInBrowser(line: Speakable): Promise<void> {
    if (typeof speechSynthesis === "undefined" || !line.jp) return;
    const style = BROWSER_VOICE[line.speaker] ?? { pitch: 1, rate: 0.95, male: false, prefer: /kyoko/i };
    const { voice, genderMatched } = chooseVoice(await japaneseVoices(), style.male, style.prefer);
    const u = new SpeechSynthesisUtterance(line.jp);
    u.lang = "ja-JP";
    if (voice) u.voice = voice;
    // No male Japanese voice installed: deepen a female one as best we can.
    u.pitch = style.male && !genderMatched ? Math.min(style.pitch, 0.55) : style.pitch;
    u.rate = style.rate;
    u.volume = Math.min(1, this.volume * mixer.voiceVolume);
    return new Promise<void>((resolve) => {
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }

  stop() {
    this.current?.pause();
    this.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    mixer.duck(false);
  }

  dispose() {
    this.stop();
    for (const p of this.urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
    this.urls.clear();
    for (const p of this.previewUrls.values()) p.then((u) => u && URL.revokeObjectURL(u));
    this.previewUrls.clear();
  }
}

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

/**
 * Push-to-talk recorder. `level` (0–1) drives the mic ring animation.
 * The microphone stream is opened once (`prepare`) and kept warm, so
 * holding Space starts recording instantly. Releasing before the mic is
 * ready cancels the take instead of leaving it recording.
 */
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const raf = useRef<number>(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  /** True between press and release, even while the mic is still opening. */
  const held = useRef(false);
  const startedAt = useRef(0);

  const ensureStream = useCallback(async () => {
    const live = streamRef.current?.getAudioTracks().some((t) => t.readyState === "live");
    if (streamRef.current && live) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    return stream;
  }, []);

  /** Asks for mic permission ahead of the first take. */
  const prepare = useCallback(async () => {
    try {
      await ensureStream();
      setError(null);
    } catch {
      setError("Microphone blocked — allow it in your browser's address bar, or type instead.");
    }
  }, [ensureStream]);

  const start = useCallback(async () => {
    if (held.current || recRef.current) return;
    held.current = true;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await ensureStream();
    } catch {
      held.current = false;
      setError("Microphone blocked — allow it in your browser's address bar, or type instead.");
      return;
    }
    // Released while the permission prompt / device was opening.
    if (!held.current) return;

    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.start(100);
    recRef.current = rec;
    startedAt.current = performance.now();
    setRecording(true);

    const ctx = (ctxRef.current ??= new AudioContext());
    if (ctx.state === "suspended") void ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    srcRef.current = src;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      if (frame++ % 3 === 0) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      }
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }, [ensureStream]);

  /** Stops recording; resolves to the audio, or null if nothing usable was captured. */
  const stop = useCallback(async (): Promise<Blob | null> => {
    held.current = false;
    const rec = recRef.current;
    if (!rec) return null;
    cancelAnimationFrame(raf.current);
    srcRef.current?.disconnect();
    srcRef.current = null;
    setLevel(0);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.stop();
    await done;
    recRef.current = null;
    setRecording(false);
    const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
    const longEnough = performance.now() - startedAt.current > 350;
    return longEnough && blob.size > 1000 ? blob : null;
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close();
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { recording, level, error, clearError, prepare, start, stop };
}
