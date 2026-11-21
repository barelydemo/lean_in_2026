// Generative background music: original, endlessly varying, and free of any
// copyright because it is composed live in the browser.

import { burst, tone } from "./synth";

interface Mood {
  root: number; // MIDI note of the key's tonic
  bpm: number;
  chords: number[][]; // semitone offsets from root, one chord per bar
  scale: number[]; // melody scale (semitones from root)
  keys: "epiano" | "pluck" | "none";
  arp: number[]; // 16th-step pattern of chord-tone indexes (-1 = rest)
  drums: "lofi" | "machine" | "rim" | "none";
  melody: number; // 0..1 note density
  pad: number; // pad level
  crackle: boolean;
}

const PENTA_MAJ = [0, 2, 4, 7, 9];
const PENTA_MIN = [0, 3, 5, 7, 10];

export const MOODS: Record<string, Mood> = {
  title: {
    root: 62, bpm: 88, chords: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]],
    scale: PENTA_MAJ, keys: "epiano", arp: [0, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 0, -1, 2, -1],
    drums: "none", melody: 0.35, pad: 0.6, crackle: false,
  },
  morning: {
    root: 65, bpm: 84, chords: [[0, 4, 7, 11], [4, 7, 11, 14], [9, 12, 16, 19], [5, 9, 12, 16]],
    scale: PENTA_MAJ, keys: "epiano", arp: [0, -1, -1, 2, -1, -1, 1, -1, 3, -1, -1, 2, -1, 1, -1, -1],
    drums: "lofi", melody: 0.25, pad: 0.4, crackle: true,
  },
  careful: {
    root: 57, bpm: 90, chords: [[0, 3, 7], [8, 12, 15], [5, 8, 12], [7, 11, 14]],
    scale: PENTA_MIN, keys: "pluck", arp: [0, -1, 2, -1, 1, -1, 2, -1, 0, -1, 2, -1, 1, 2, -1, -1],
    drums: "rim", melody: 0.18, pad: 0.25, crackle: false,
  },
  journey: {
    root: 67, bpm: 100, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]],
    scale: PENTA_MAJ, keys: "pluck", arp: [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1],
    drums: "lofi", melody: 0.3, pad: 0.35, crackle: false,
  },
  night: {
    root: 63, bpm: 96, chords: [[5, 9, 12, 16], [4, 7, 11, 14], [2, 5, 9, 12], [0, 4, 7, 11]],
    scale: PENTA_MAJ, keys: "epiano", arp: [0, -1, -1, 3, -1, 2, -1, -1, 1, -1, 3, -1, -1, 2, -1, -1],
    drums: "machine", melody: 0.3, pad: 0.55, crackle: false,
  },
  cozy: {
    root: 60, bpm: 76, chords: [[0, 4, 7, 11], [5, 9, 12, 16], [4, 7, 11, 14], [9, 12, 16, 19]],
    scale: PENTA_MAJ, keys: "epiano", arp: [0, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1, 3, -1, -1, -1],
    drums: "none", melody: 0.15, pad: 0.45, crackle: true,
  },
  finale: {
    root: 62, bpm: 88, chords: [[5, 9, 12], [7, 11, 14], [4, 7, 11], [9, 12, 16]],
    scale: PENTA_MAJ, keys: "epiano", arp: [0, -1, 1, -1, 2, -1, 1, -1, 0, -1, 1, -1, 2, -1, 3, -1],
    drums: "lofi", melody: 0.45, pad: 0.7, crackle: false,
  },
  town: {
    root: 64, bpm: 92, chords: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]],
    scale: PENTA_MAJ, keys: "pluck", arp: [0, -1, 2, 1, -1, 2, -1, 1, 0, -1, 2, 1, -1, 3, -1, 2],
    drums: "lofi", melody: 0.35, pad: 0.3, crackle: true,
  },
  work: {
    root: 67, bpm: 118, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]],
    scale: PENTA_MAJ, keys: "pluck", arp: [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 0, 2, 1, 2],
    drums: "machine", melody: 0.4, pad: 0.2, crackle: false,
  },
  cafe: {
    root: 58, bpm: 78, chords: [[2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11], [9, 12, 16, 19]],
    scale: PENTA_MAJ, keys: "epiano", arp: [0, -1, -1, 2, -1, -1, 3, -1, 1, -1, -1, 2, -1, -1, -1, -1],
    drums: "rim", melody: 0.22, pad: 0.45, crackle: true,
  },
  festival: {
    root: 62, bpm: 112, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]],
    scale: PENTA_MAJ, keys: "pluck", arp: [0, 2, 1, 2, 0, 2, 1, 3, 0, 2, 1, 2, 3, 2, 1, 0],
    drums: "machine", melody: 0.5, pad: 0.4, crackle: false,
  },
  theatre: {
    root: 55, bpm: 70, chords: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [10, 14, 17]],
    scale: [0, 1, 5, 7, 8], keys: "pluck", arp: [0, -1, -1, -1, 2, -1, -1, 1, -1, -1, -1, -1, 2, -1, -1, -1],
    drums: "rim", melody: 0.15, pad: 0.5, crackle: false,
  },
  memory: {
    root: 60, bpm: 66, chords: [[9, 12, 16], [5, 9, 12], [0, 4, 7], [7, 11, 14]],
    scale: PENTA_MIN, keys: "epiano", arp: [0, -1, -1, -1, 1, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1],
    drums: "none", melody: 0.2, pad: 0.6, crackle: false,
  },
  clinic: {
    root: 65, bpm: 64, chords: [[0, 4, 7, 11], [5, 9, 12, 16], [2, 5, 9, 12], [7, 11, 14, 17]],
    scale: PENTA_MAJ, keys: "epiano", arp: [0, -1, 2, -1, -1, -1, 3, -1, 1, -1, -1, -1, 2, -1, -1, -1],
    drums: "none", melody: 0.12, pad: 0.65, crackle: false,
  },
};

const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

function reverb(ctx: AudioContext, seconds = 2.6): ConvolverNode {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
  }
  const c = ctx.createConvolver();
  c.buffer = buf;
  return c;
}

export class GenerativeMusic {
  private out: GainNode;
  private wet: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private lastNote: number;

  constructor(private ctx: AudioContext, dest: AudioNode, private mood: Mood) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    const rv = reverb(ctx);
    this.out.connect(lp).connect(dest);
    this.out.connect(this.wet).connect(rv).connect(dest);
    this.lastNote = mood.root + 12;
  }

  start(fade = 2.5) {
    const t = this.ctx.currentTime;
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(0.9, t + fade);
    this.nextTime = t + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop(fade = 2) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => {
      if (this.timer) clearInterval(this.timer);
      this.out.disconnect();
    }, fade * 1000 + 200);
  }

  private schedule() {
    const sixteenth = 60 / this.mood.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime - this.ctx.currentTime);
      this.step = (this.step + 1) % (16 * this.mood.chords.length);
      this.nextTime += sixteenth * (this.step % 2 ? 1.04 : 0.96); // a little swing
    }
  }

  private playStep(step: number, at: number) {
    const m = this.mood;
    const bar = Math.floor(step / 16) % m.chords.length;
    const s = step % 16;
    const chord = m.chords[bar].map((c) => m.root + c);
    const beat = 60 / m.bpm;
    const ctx = this.ctx;
    const out = this.out;

    // pad: one slow chord per bar
    if (s === 0 && m.pad > 0) {
      chord.forEach((n, i) =>
        [-6, 6].forEach((det) =>
          tone(ctx, out, { freq: hz(n - 12), type: "triangle", at, attack: beat * 1.2, decay: beat * 3.4, gain: 0.018 * m.pad, detune: det + i }),
        ),
      );
    }
    // bass on 1 and the "and" of 3
    if (s === 0 || s === 10) {
      tone(ctx, out, { freq: hz(chord[0] - 24), type: "sine", at, attack: 0.01, decay: beat * 1.4, gain: 0.12 });
    }
    // keys / arpeggio
    const idx = m.arp[s];
    if (m.keys !== "none" && idx >= 0) {
      const n = chord[idx % chord.length] + (idx >= chord.length ? 12 : 0);
      if (m.keys === "epiano") {
        tone(ctx, out, { freq: hz(n), type: "sine", at, decay: beat * 1.6, gain: 0.05 });
        tone(ctx, out, { freq: hz(n) * 2, type: "sine", at, decay: beat * 0.4, gain: 0.012 });
      } else {
        tone(ctx, out, { freq: hz(n + 12), type: "triangle", at, decay: beat * 0.35, gain: 0.045 });
      }
    }
    // melody: a gentle random walk over the scale, landing on chord tones
    if ((s === 2 || s === 6 || s === 10 || s === 14 || s === 8) && Math.random() < m.melody) {
      const scale = [...m.scale.map((x) => m.root + 12 + x), ...m.scale.map((x) => m.root + 24 + x)];
      const near = scale.filter((n) => Math.abs(n - this.lastNote) <= 4);
      const pool = near.length ? near : scale;
      const n = pool[Math.floor(Math.random() * pool.length)];
      this.lastNote = n;
      tone(ctx, out, { freq: hz(n), type: "triangle", at, attack: 0.01, decay: beat * 1.1, gain: 0.035 });
    }
    // drums
    if (m.drums !== "none") {
      const kick = m.drums === "machine" ? s === 0 || s === 8 || s === 11 : s === 0 || s === 7 || s === 10;
      if (kick && m.drums !== "rim") tone(ctx, out, { freq: 110, slideTo: 42, at, decay: 0.28, gain: 0.22 });
      if (s === 4 || s === 12) {
        if (m.drums === "rim") burst(ctx, out, { at, dur: 0.05, freq: 1800, q: 8, gain: 0.06 });
        else burst(ctx, out, { at, dur: 0.16, freq: 1800, q: 0.8, gain: 0.07 });
      }
      if (s % 2 === 0 && m.drums !== "rim") burst(ctx, out, { at, dur: 0.04, freq: 8000, filter: "highpass", gain: s % 4 ? 0.012 : 0.022 });
    }
    // vinyl crackle
    if (m.crackle && Math.random() < 0.35) {
      burst(ctx, out, { at: at + Math.random() * 0.1, dur: 0.008, freq: 3000 + Math.random() * 4000, filter: "highpass", gain: 0.02 });
    }
  }
}
