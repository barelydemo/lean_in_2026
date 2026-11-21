import type { Ambient, Expression, Line } from "./types";
import { EXTRA, NARRATOR, PLAYER, THOUGHT, TOWNSFOLK_PREFIX } from "./types";

export interface Actor {
  id: string;
  from: "left" | "right";
  /** Where they walk off to when they exit. */
  exitTo?: "left" | "right";
  /** Talking with the player, up front. Otherwise they're in the background,
   *  going about their business, until one of them speaks or is approached. */
  near: boolean;
}

/** Persistent stage state. Must stay in step with RunState::track_stage on the server. */
export interface StageState {
  scene: string;
  ambient: Ambient;
  actors: Actor[];
  expressions: Record<string, Expression>;
  flipped: Record<string, boolean>;
  speaker: string | null;
  /** Set by a blackout; cleared by the next visual transition. */
  dark: boolean;
  zoom: number;
  pan: number;
}

export function initialStage(scene: string, ambient: Ambient): StageState {
  return { scene, ambient, actors: [], expressions: {}, flipped: {}, speaker: null, dark: false, zoom: 1, pan: 0 };
}

export function isCast(speaker: string) {
  return speaker !== NARRATOR && speaker !== THOUGHT && speaker !== EXTRA && speaker !== PLAYER;
}

export function applyLine(s: StageState, line: Line): StageState {
  const next: StageState = {
    ...s,
    actors: [...s.actors],
    expressions: { ...s.expressions },
    flipped: { ...s.flipped },
  };

  if (line.scene && line.scene !== "keep" && line.scene !== s.scene) {
    next.scene = line.scene;
    next.actors = [];
    next.zoom = 1;
    next.pan = 0;
  }
  if (line.ambient && line.ambient !== "keep") next.ambient = line.ambient;

  const t = line.transition ?? "none";
  if (t === "blackout") next.dark = true;
  else if (t !== "none" && t !== "flash") next.dark = false;

  switch (line.camera) {
    case "zoom_in": next.zoom = 1.12; break;
    case "zoom_out": next.zoom = 1; break;
    case "pan_left": next.pan = 3; break;
    case "pan_right": next.pan = -3; break;
  }

  for (const id of line.enter ?? []) {
    if (!next.actors.some((a) => a.id === id)) next.actors.push({ id, from: next.actors.length % 2 ? "left" : "right", near: false });
  }

  if (isCast(line.speaker)) {
    const id = line.speaker;
    const action = line.action ?? "none";
    // One passer-by on stage at a time: the next stranger replaces the last.
    if (id.startsWith(TOWNSFOLK_PREFIX)) next.actors = next.actors.filter((a) => !a.id.startsWith(TOWNSFOLK_PREFIX) || a.id === id);
    if (action === "exit_left" || action === "exit_right") {
      next.actors = next.actors.filter((a) => a.id !== id);
    } else if (!next.actors.some((a) => a.id === id)) {
      next.actors.push({ id, from: action === "enter_left" ? "left" : "right", near: true });
    } else if (line.jp) {
      // Whoever speaks to the player steps up to them.
      next.actors = next.actors.map((a) => (a.id === id ? { ...a, near: true } : a));
    }
    next.expressions[id] = line.expression ?? "neutral";
    if (action === "turn_away") next.flipped[id] = true;
    else next.flipped[id] = false;
    next.speaker = id;
  } else {
    next.speaker = line.speaker === PLAYER ? PLAYER : null;
  }
  return next;
}

/** Fast-forwards a backlog without animation (used when continuing a save). */
export function replay(scene: string, ambient: Ambient, lines: Line[]): StageState {
  let s = initialStage(scene, ambient);
  for (const l of lines) s = applyLine(s, l);
  s.dark = false;
  return s;
}

/** Background spots for people not (yet) talking with the player: off to the sides. */
export const FAR_SLOTS = [80, 20, 66, 34];

/** Horizontal slot (percent of stage width) for each actor. */
export function slots(count: number): number[] {
  switch (count) {
    case 0: return [];
    case 1: return [50];
    case 2: return [30, 70];
    case 3: return [20, 50, 80];
    default: return Array.from({ length: count }, (_, i) => 12 + (76 * i) / (count - 1));
  }
}
