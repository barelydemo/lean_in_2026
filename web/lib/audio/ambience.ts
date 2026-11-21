// Procedural ambience beds: shaped noise plus small scheduled events
// (chimes, birds, ticks, clacks), one per scene type.

import { burst, noise, tone } from "./synth";

interface Bed {
  filter: BiquadFilterType;
  freq: number;
  q: number;
  gain: number;
  hum?: number; // mains/fridge hum frequency
  event?: { every: [number, number]; play: (ctx: AudioContext, out: AudioNode) => void };
  rhythm?: { interval: number; play: (ctx: AudioContext, out: AudioNode, n: number) => void };
}

const BEDS: Record<string, Bed> = {
  park: {
    filter: "lowpass", freq: 320, q: 0.4, gain: 0.14,
    rhythm: { interval: 0.7, play: (c, o, n) => { if (n % 3 !== 2) [0, 0.06].forEach((at) => tone(c, o, { freq: 4100, at, decay: 0.03, gain: 0.005 })); } },
  },
  izakaya: {
    filter: "bandpass", freq: 700, q: 0.4, gain: 0.26,
    event: { every: [3, 7], play: (c, o) => tone(c, o, { freq: 2600 + Math.random() * 800, decay: 0.25, gain: 0.025 }) },
  },
  cafe: {
    filter: "highpass", freq: 2500, q: 0.3, gain: 0.07,
    event: { every: [5, 11], play: (c, o) => tone(c, o, { freq: 3200, decay: 0.18, gain: 0.02 }) },
  },
  festival: {
    filter: "bandpass", freq: 600, q: 0.4, gain: 0.25,
    rhythm: { interval: 0.5, play: (c, o, n) => { if (n % 8 === 0 || n % 8 === 3) tone(c, o, { freq: 90, slideTo: 55, decay: 0.3, gain: 0.12 }); } },
  },
  theatre: {
    filter: "lowpass", freq: 500, q: 0.4, gain: 0.12,
    event: { every: [10, 20], play: (c, o) => [0, 0.18].forEach((at) => burst(c, o, { at, dur: 0.04, freq: 1800, q: 6, gain: 0.08 })) },
  },
  clinic: {
    filter: "lowpass", freq: 280, q: 0.4, gain: 0.09, hum: 60,
    rhythm: { interval: 1, play: (c, o, n) => burst(c, o, { dur: 0.02, freq: n % 2 ? 3000 : 2600, q: 10, gain: 0.02 }) },
  },
  airport: {
    filter: "lowpass", freq: 700, q: 0.5, gain: 0.22,
    event: { every: [9, 18], play: (c, o) => [0, 0.45].forEach((at, i) => tone(c, o, { freq: [784, 659][i], at, decay: 1.4, gain: 0.025 })) },
  },
  curbside: {
    filter: "lowpass", freq: 450, q: 0.4, gain: 0.25,
    event: { every: [2, 6], play: (c, o) => { const f = 3200 + Math.random() * 1200; [0, 0.09, 0.18].forEach((at) => tone(c, o, { freq: f, slideTo: f * 1.3, at, decay: 0.07, gain: 0.012 })); } },
  },
  koban: {
    filter: "lowpass", freq: 300, q: 0.4, gain: 0.1,
    rhythm: { interval: 1, play: (c, o, n) => burst(c, o, { dur: 0.02, freq: n % 2 ? 3200 : 2700, q: 10, gain: 0.03 }) },
  },
  station: {
    filter: "bandpass", freq: 500, q: 0.4, gain: 0.25,
    event: { every: [4, 10], play: (c, o) => [0, 0.12].forEach((at) => tone(c, o, { freq: 1568, at, decay: 0.06, gain: 0.02, type: "square" })) },
  },
  train: {
    filter: "lowpass", freq: 260, q: 0.6, gain: 0.32, hum: 55,
    rhythm: { interval: 0.42, play: (c, o, n) => { if (n % 4 < 2) burst(c, o, { dur: 0.07, freq: 180, filter: "lowpass", gain: 0.12 }); } },
  },
  city_night: {
    filter: "lowpass", freq: 380, q: 0.5, gain: 0.26,
    event: { every: [12, 24], play: (c, o) => burst(c, o, { dur: 5, freq: 120, sweepTo: 300, filter: "lowpass", gain: 0.18, attack: 1.6 }) },
  },
  konbini: {
    filter: "highpass", freq: 4000, q: 0.3, gain: 0.025, hum: 100,
  },
  hostel: {
    filter: "lowpass", freq: 250, q: 0.4, gain: 0.08,
    rhythm: { interval: 0.6, play: (c, o, n) => { if (n % 5 !== 4) [0, 0.05, 0.1].forEach((at) => tone(c, o, { freq: 4400, at, decay: 0.03, gain: 0.006 })); } },
  },
  police_station: {
    filter: "bandpass", freq: 650, q: 0.5, gain: 0.18,
    rhythm: { interval: 0.18, play: (c, o, n) => { if (Math.random() < 0.3 && n % 40 < 18) burst(c, o, { dur: 0.015, freq: 2500, q: 4, gain: 0.025 }); } },
  },
};

export class ProceduralAmbience {
  private out: GainNode;
  private nodes: AudioScheduledSourceNode[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private alive = true;

  constructor(private ctx: AudioContext, dest: AudioNode, id: string) {
    const bed = BEDS[id] ?? BEDS.airport;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);

    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = bed.filter;
    f.frequency.value = bed.freq;
    f.Q.value = bed.q;
    // slow swell so the bed breathes
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = bed.freq * 0.25;
    lfo.connect(lfoGain).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.value = bed.gain;
    src.connect(f).connect(g).connect(this.out);
    src.start();
    lfo.start();
    this.nodes.push(src, lfo);

    if (bed.hum) {
      const h = ctx.createOscillator();
      h.frequency.value = bed.hum;
      const hg = ctx.createGain();
      hg.gain.value = 0.02;
      h.connect(hg).connect(this.out);
      h.start();
      this.nodes.push(h);
    }
    if (bed.event) {
      const ev = bed.event;
      const loop = () => {
        if (!this.alive) return;
        ev.play(ctx, this.out);
        this.timers.push(setTimeout(loop, (ev.every[0] + Math.random() * (ev.every[1] - ev.every[0])) * 1000));
      };
      this.timers.push(setTimeout(loop, 1500 + Math.random() * 3000));
    }
    if (bed.rhythm) {
      const r = bed.rhythm;
      let n = 0;
      const loop = () => {
        if (!this.alive) return;
        r.play(ctx, this.out, n++);
        this.timers.push(setTimeout(loop, r.interval * 1000));
      };
      loop();
    }
  }

  start(fade = 2) {
    const t = this.ctx.currentTime;
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(1, t + fade);
  }

  stop(fade = 1.5) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => {
      this.alive = false;
      this.timers.forEach(clearTimeout);
      this.nodes.forEach((n) => { try { n.stop(); } catch {} });
      this.out.disconnect();
    }, fade * 1000 + 100);
  }
}
