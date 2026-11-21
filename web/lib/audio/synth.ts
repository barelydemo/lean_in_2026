// Procedural sound effects. Everything is synthesised with Web Audio, so
// there are no sample files and nothing to license.

export type SfxName =
  | "door_chime" | "train_doors" | "radio" | "phone" | "stamp" | "coins"
  | "footsteps" | "thud" | "whoosh" | "bell";

export type UiSound =
  | "tap" | "advance" | "type" | "hover" | "choice" | "mic_on" | "mic_off" | "send"
  | "success" | "retry" | "grammar" | "chapter" | "chapter_end" | "yen" | "item"
  | "open" | "close" | "impact" | "sparkle" | "sweat" | "heart" | "anger"
  | "question" | "exclaim" | "music_note" | "gloom";

let noiseBuffer: AudioBuffer | null = null;

export function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

interface ToneOpts {
  freq: number;
  type?: OscillatorType;
  at?: number;
  attack?: number;
  decay?: number;
  gain?: number;
  slideTo?: number;
  detune?: number;
}

/** A single enveloped oscillator note. */
export function tone(ctx: BaseAudioContext, out: AudioNode, o: ToneOpts) {
  const t = ctx.currentTime + (o.at ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.detune) osc.detune.value = o.detune;
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + (o.decay ?? 0.3));
  const peak = o.gain ?? 0.3;
  const atk = o.attack ?? 0.005;
  const dec = o.decay ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + atk + dec + 0.05);
}

interface NoiseOpts {
  at?: number;
  dur: number;
  gain?: number;
  filter?: BiquadFilterType;
  freq?: number;
  q?: number;
  sweepTo?: number;
  attack?: number;
}

/** A filtered noise burst. */
export function burst(ctx: BaseAudioContext, out: AudioNode, o: NoiseOpts) {
  const t = ctx.currentTime + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? "bandpass";
  f.frequency.setValueAtTime(o.freq ?? 1000, t);
  f.Q.value = o.q ?? 1;
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
  const g = ctx.createGain();
  const atk = o.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + o.dur + 0.05);
}

/** A soft bell: inharmonic partials with long decay. */
function bellTone(ctx: BaseAudioContext, out: AudioNode, freq: number, at = 0, gain = 0.15, decay = 1.6) {
  [1, 2.01, 2.76, 4.07].forEach((ratio, i) =>
    tone(ctx, out, { freq: freq * ratio, at, decay: decay / (1 + i * 0.6), gain: gain / (1 + i * 1.4) }),
  );
}

export function playUi(ctx: BaseAudioContext, out: AudioNode, name: UiSound) {
  switch (name) {
    case "tap":
      return tone(ctx, out, { freq: 880, decay: 0.05, gain: 0.08 });
    case "hover":
      return tone(ctx, out, { freq: 1320, decay: 0.03, gain: 0.025 });
    case "advance":
      tone(ctx, out, { freq: 660, decay: 0.07, gain: 0.06, type: "triangle" });
      return tone(ctx, out, { freq: 990, at: 0.03, decay: 0.06, gain: 0.04 });
    case "type":
      return tone(ctx, out, { freq: 1500 + Math.random() * 300, decay: 0.018, gain: 0.018, type: "triangle" });
    case "choice":
      tone(ctx, out, { freq: midi(76), decay: 0.12, gain: 0.08, type: "triangle" });
      return tone(ctx, out, { freq: midi(83), at: 0.05, decay: 0.16, gain: 0.07, type: "triangle" });
    case "mic_on":
      return tone(ctx, out, { freq: 520, slideTo: 880, decay: 0.12, gain: 0.08 });
    case "mic_off":
      return tone(ctx, out, { freq: 880, slideTo: 520, decay: 0.12, gain: 0.08 });
    case "send":
      return burst(ctx, out, { dur: 0.25, freq: 900, sweepTo: 3500, gain: 0.05, q: 0.8 });
    case "success":
      [72, 76, 79, 84].forEach((n, i) => tone(ctx, out, { freq: midi(n), at: i * 0.07, decay: 0.35, gain: 0.07, type: "triangle" }));
      return;
    case "retry":
      tone(ctx, out, { freq: midi(67), decay: 0.18, gain: 0.07, type: "triangle" });
      return tone(ctx, out, { freq: midi(64), at: 0.12, decay: 0.3, gain: 0.06, type: "triangle" });
    case "grammar":
    case "sparkle":
      [88, 91, 95, 100].forEach((n, i) => tone(ctx, out, { freq: midi(n), at: i * 0.05, decay: 0.4, gain: 0.04 }));
      return;
    case "chapter":
      bellTone(ctx, out, midi(57), 0, 0.2, 3.2);
      return bellTone(ctx, out, midi(64), 0.4, 0.12, 2.6);
    case "chapter_end":
      [67, 71, 74, 79, 83].forEach((n, i) => tone(ctx, out, { freq: midi(n), at: i * 0.11, decay: 0.7, gain: 0.07, type: "triangle" }));
      return bellTone(ctx, out, midi(79), 0.6, 0.1, 2.4);
    case "yen":
    case "item":
      tone(ctx, out, { freq: midi(88), decay: 0.12, gain: 0.07, type: "square" });
      return tone(ctx, out, { freq: midi(95), at: 0.08, decay: 0.35, gain: 0.06, type: "square" });
    case "open":
      return burst(ctx, out, { dur: 0.22, freq: 2500, filter: "highpass", gain: 0.04 });
    case "close":
      return burst(ctx, out, { dur: 0.18, freq: 1800, filter: "highpass", gain: 0.03 });
    case "impact":
      tone(ctx, out, { freq: 120, slideTo: 40, decay: 0.5, gain: 0.5 });
      return burst(ctx, out, { dur: 0.35, freq: 600, filter: "lowpass", gain: 0.35 });
    case "sweat":
      return tone(ctx, out, { freq: 1200, slideTo: 500, decay: 0.15, gain: 0.06 });
    case "heart":
      tone(ctx, out, { freq: midi(84), decay: 0.12, gain: 0.06 });
      return tone(ctx, out, { freq: midi(88), at: 0.1, decay: 0.25, gain: 0.06 });
    case "anger":
      return burst(ctx, out, { dur: 0.12, freq: 2200, q: 6, gain: 0.08 });
    case "question":
      return tone(ctx, out, { freq: 500, slideTo: 900, decay: 0.2, gain: 0.07, type: "triangle" });
    case "exclaim":
      return tone(ctx, out, { freq: midi(86), decay: 0.25, gain: 0.08, type: "triangle" });
    case "music_note":
      [79, 83].forEach((n, i) => tone(ctx, out, { freq: midi(n), at: i * 0.15, decay: 0.25, gain: 0.05, type: "triangle" }));
      return;
    case "gloom":
      return tone(ctx, out, { freq: 300, slideTo: 180, decay: 0.7, gain: 0.07, type: "triangle" });
  }
}

/** Fallbacks for the story's sound cues (the director's `sfx`). */
export function playSfx(ctx: BaseAudioContext, out: AudioNode, name: SfxName) {
  switch (name) {
    case "door_chime":
      // A generic two-tone shop chime.
      bellTone(ctx, out, midi(83), 0, 0.12, 1.2);
      return bellTone(ctx, out, midi(79), 0.35, 0.12, 1.6);
    case "train_doors":
      [0, 0.35, 0.7].forEach((at) => tone(ctx, out, { freq: 1046, at, decay: 0.2, gain: 0.06, type: "square" }));
      return burst(ctx, out, { at: 1.1, dur: 0.9, freq: 900, sweepTo: 300, gain: 0.15, filter: "lowpass", attack: 0.05 });
    case "radio":
      burst(ctx, out, { dur: 0.6, freq: 2500, q: 0.7, gain: 0.12 });
      return tone(ctx, out, { freq: 1400, at: 0.6, decay: 0.12, gain: 0.05, type: "square" });
    case "phone":
      for (let ring = 0; ring < 2; ring++)
        for (let k = 0; k < 10; k++)
          tone(ctx, out, { freq: k % 2 ? 480 : 440, at: ring * 1.2 + k * 0.05, decay: 0.05, gain: 0.05, type: "square" });
      return;
    case "stamp":
      tone(ctx, out, { freq: 90, slideTo: 50, decay: 0.15, gain: 0.4 });
      return burst(ctx, out, { dur: 0.08, freq: 3000, filter: "highpass", gain: 0.1 });
    case "coins":
      for (let i = 0; i < 4; i++) tone(ctx, out, { freq: 3000 + Math.random() * 1500, at: i * 0.07 + Math.random() * 0.03, decay: 0.2, gain: 0.04 });
      return;
    case "footsteps":
      for (let i = 0; i < 4; i++) burst(ctx, out, { at: i * 0.28, dur: 0.09, freq: 300 + (i % 2) * 80, filter: "lowpass", gain: 0.2 });
      return;
    case "thud":
      tone(ctx, out, { freq: 80, slideTo: 35, decay: 0.6, gain: 0.6 });
      return burst(ctx, out, { dur: 0.25, freq: 400, filter: "lowpass", gain: 0.4 });
    case "whoosh":
      return burst(ctx, out, { dur: 0.55, freq: 400, sweepTo: 4000, gain: 0.1, q: 0.6, attack: 0.15 });
    case "bell":
      return bellTone(ctx, out, midi(55), 0, 0.22, 4);
  }
}
