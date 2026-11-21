"use client";

import { ProceduralAmbience } from "./ambience";
import { GenerativeMusic, MOODS } from "./music";
import { playSfx, playUi, type SfxName, type UiSound } from "./synth";

export interface Volumes {
  music: number;
  ambience: number;
  sfx: number;
  voice: number;
}

export interface AudioManifest {
  music: Record<string, string>;
  ambience: Record<string, string>;
  sfx: Record<string, string>;
}

interface Layer {
  id: string;
  stop: (fade?: number) => void;
}

/**
 * The game's mixer. Generated (ElevenLabs) files are used when the server
 * has them; otherwise music, ambience and effects are synthesised, so the
 * game is never silent and never needs licensed audio.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private bus: Record<"music" | "ambience" | "sfx", GainNode> | null = null;
  private manifest: AudioManifest = { music: {}, ambience: {}, sfx: {} };
  private base = "";
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private music: Layer | null = null;
  private amb: Layer | null = null;
  private want = { music: "", ambience: "" };
  private volumes: Volumes = { music: 0.55, ambience: 0.6, sfx: 0.8, voice: 1 };
  private ducked = false;
  private lastType = 0;

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      this.bus = {
        music: ctx.createGain(),
        ambience: ctx.createGain(),
        sfx: ctx.createGain(),
      };
      for (const g of Object.values(this.bus)) g.connect(master);
      this.ctx = ctx;
      this.applyVolumes();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    // Start whatever the game asked for before audio was allowed.
    if (this.want.music && !this.music) this.playMusic(this.want.music);
    if (this.want.ambience && !this.amb) this.playAmbience(this.want.ambience);
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  setManifest(m: AudioManifest, apiOrigin: string) {
    this.manifest = m;
    this.base = apiOrigin;
    // Another course's files: restart what's playing so ids like "title"
    // pick up this course's version.
    const { music, ambience } = this.want;
    this.music?.stop(1.5);
    this.amb?.stop(1.5);
    this.music = null;
    this.amb = null;
    if (music) this.playMusic(music);
    if (ambience) this.playAmbience(ambience);
  }

  setVolumes(v: Partial<Volumes>) {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  get voiceVolume() {
    return this.volumes.voice;
  }

  private applyVolumes() {
    if (!this.ctx || !this.bus) return;
    const t = this.ctx.currentTime;
    const music = this.volumes.music * (this.ducked ? 0.45 : 1);
    this.bus.music.gain.setTargetAtTime(music, t, 0.25);
    this.bus.ambience.gain.setTargetAtTime(this.volumes.ambience * (this.ducked ? 0.6 : 1), t, 0.25);
    this.bus.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  /** Lower music and ambience while a character is speaking. */
  duck(on: boolean) {
    if (this.ducked === on) return;
    this.ducked = on;
    this.applyVolumes();
  }

  private loadBuffer(path: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    let p = this.buffers.get(path);
    if (!p) {
      p = fetch(this.base + path)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(path, p);
    }
    return p;
  }

  /** Loops a decoded file with fades; returns a stoppable layer. */
  private loopFile(buffer: AudioBuffer, dest: AudioNode, fade: number): Layer["stop"] {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + fade);
    src.connect(g).connect(dest);
    src.start();
    return (out = 2) => {
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + out);
      src.stop(t + out + 0.1);
    };
  }

  playMusic(id: string) {
    this.want.music = id;
    if (!this.ctx || !this.bus || this.music?.id === id) return;
    this.music?.stop(2.5);
    const layer: Layer = { id, stop: () => {} };
    this.music = layer;
    const file = this.manifest.music[id];
    const dest = this.bus.music;
    const fallback = () => {
      if (this.music !== layer) return;
      const g = new GenerativeMusic(this.ctx!, dest, MOODS[id] ?? MOODS.title);
      g.start();
      layer.stop = (f) => g.stop(f);
    };
    if (!file) return fallback();
    this.loadBuffer(file).then((buf) => {
      if (this.music !== layer) return;
      if (!buf) return fallback();
      layer.stop = this.loopFile(buf, dest, 2.5);
    });
  }

  playAmbience(id: string) {
    this.want.ambience = id;
    if (!this.ctx || !this.bus || this.amb?.id === id) return;
    this.amb?.stop(1.5);
    const layer: Layer = { id, stop: () => {} };
    this.amb = layer;
    const file = this.manifest.ambience[id];
    const dest = this.bus.ambience;
    const fallback = () => {
      if (this.amb !== layer) return;
      const a = new ProceduralAmbience(this.ctx!, dest, id);
      a.start();
      layer.stop = (f) => a.stop(f);
    };
    if (!file) return fallback();
    this.loadBuffer(file).then((buf) => {
      if (this.amb !== layer) return;
      if (!buf) return fallback();
      layer.stop = this.loopFile(buf, dest, 2);
    });
  }

  stopAll() {
    this.music?.stop(1.5);
    this.amb?.stop(1.5);
    this.music = this.amb = null;
    this.want = { music: "", ambience: "" };
  }

  /** A story sound cue: the generated file if present, else the synth. */
  sfx(name: SfxName) {
    if (!this.ctx || !this.bus) return;
    const file = this.manifest.sfx[name];
    const bus = this.bus.sfx;
    if (!file) return playSfx(this.ctx, bus, name);
    this.loadBuffer(file).then((buf) => {
      if (!buf || !this.ctx) return playSfx(this.ctx!, bus, name);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(bus);
      src.start();
    });
  }

  ui(name: UiSound) {
    if (!this.ctx || !this.bus || this.ctx.state !== "running") return;
    if (name === "type") {
      // Typewriter ticks are rate-limited so fast text doesn't buzz.
      const now = performance.now();
      if (now - this.lastType < 55) return;
      this.lastType = now;
    }
    playUi(this.ctx, this.bus.sfx, name);
  }
}

export const audio = new AudioEngine();
export type { SfxName, UiSound };
