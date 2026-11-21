"use client";

import { motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import type { Action, Emote as EmoteName, Expression } from "@/lib/types";
import { Emote, ThinkingDots } from "./Emote";

export interface Cue {
  action: Action;
  emote: EmoteName;
  nonce: number;
}

interface Props {
  id: string;
  sprite: string;
  name: string;
  slot: number;
  from: "left" | "right";
  speaking: boolean;
  someoneSpeaking: boolean;
  expression: Expression;
  flipped: boolean;
  cue: Cue | null;
  thinking: boolean;
}

/** Passed through AnimatePresence `custom`, since exiting children keep stale props. */
export type ExitDirections = Record<string, "left" | "right">;

/**
 * Per-expression sprite art can be added as /characters/<id>/<expression>.png
 * and listed here; until then a single sprite is graded per expression.
 */
const EXPRESSION_ART: Record<string, Partial<Record<Expression, string>>> = {};

const EXPRESSION_FILTER: Record<Expression, string> = {
  neutral: "",
  happy: "brightness(1.06) saturate(1.1)",
  worried: "saturate(0.85)",
  surprised: "brightness(1.04)",
  thinking: "",
  annoyed: "saturate(1.05) hue-rotate(-6deg)",
  embarrassed: "saturate(1.15)",
  sad: "saturate(0.7) brightness(0.92)",
};

const ACTIONS: Partial<Record<Action, [Record<string, unknown>, Record<string, unknown>]>> = {
  hop: [{ y: [0, -46, 0, -16, 0] }, { duration: 0.65, ease: "easeOut" }],
  nod: [{ y: [0, 14, 0, 10, 0], rotate: [0, 1, 0, 1, 0] }, { duration: 0.7 }],
  shake_head: [{ x: [0, -14, 14, -10, 10, 0] }, { duration: 0.6 }],
  tremble: [{ x: [0, -3, 3, -3, 3, -2, 2, 0] }, { duration: 0.8, ease: "linear" }],
  lean_in: [{ scale: [1, 1.09, 1.07, 1], y: [0, 18, 16, 0] }, { duration: 2.2, times: [0, 0.2, 0.8, 1] }],
  bow: [{ y: [0, 40, 40, 0], scaleY: [1, 0.93, 0.93, 1] }, { duration: 1.4, times: [0, 0.3, 0.7, 1] }],
  hand: [{ y: [0, 8, -6, 0], scale: [1, 1.03, 1] }, { duration: 0.9 }],
  wave: [{ rotate: [0, -6, 6, -4, 4, 0] }, { duration: 1.0 }],
  point: [{ x: [0, 10, 0] }, { duration: 0.8 }],
  point_left: [{ x: [0, -14, 0] }, { duration: 0.8 }],
  point_right: [{ x: [0, 14, 0] }, { duration: 0.8 }],
  enter_left: [{}, {}],
  enter_right: [{}, {}],
};

export function Sprite(p: Props) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reduce = useReducedMotion();
  const art = EXPRESSION_ART[p.id]?.[p.expression] ?? p.sprite;

  useEffect(() => {
    if (!p.cue || reduce || !scope.current) return;
    const a = ACTIONS[p.cue.action];
    if (a && Object.keys(a[0]).length) animate(scope.current, a[0], a[1]);
    else if (p.expression === "surprised") animate(scope.current, { scale: [1, 1.05, 1] }, { duration: 0.35 });
  }, [p.cue?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const offscreen = (side: "left" | "right") => (side === "left" ? "-70vw" : "70vw");
  const dim = p.someoneSpeaking && !p.speaking;

  return (
    <motion.div
      className="absolute bottom-0"
      style={{ height: "min(112vh, 170vw)", aspectRatio: "432 / 578", marginBottom: "calc(min(112vh, 170vw) * -0.27)" }}
      variants={{
        out: (dirs: ExitDirections | undefined) => ({
          x: offscreen(dirs?.[p.id] ?? (p.slot < 50 ? "left" : "right")),
          opacity: 0,
        }),
      }}
      initial={{ left: `${p.slot}%`, x: offscreen(p.from), opacity: 0 }}
      animate={{ left: `${p.slot}%`, x: "-50%", opacity: 1 }}
      exit="out"
      transition={{ type: "spring", stiffness: 70, damping: 18, mass: 1, opacity: { duration: 0.5 } }}
    >
      <motion.div
        className="relative h-full w-full"
        animate={{
          filter: `${dim ? "brightness(0.6) saturate(0.75) " : ""}${EXPRESSION_FILTER[p.expression]}` || "none",
          scale: p.speaking ? 1.025 : 1,
          scaleX: p.flipped ? -1 : 1,
        }}
        transition={{ duration: 0.35 }}
        style={{ transformOrigin: "50% 100%" }}
      >
        <div ref={scope} className="relative h-full w-full" style={{ transformOrigin: "50% 100%" }}>
          {/* idle breathing */}
          <motion.div
            className="h-full w-full"
            style={{ transformOrigin: "50% 100%" }}
            animate={reduce ? undefined : { scaleY: [1, 1.012, 1], y: [0, -2, 0] }}
            transition={{ duration: 4.2 + (p.id.length % 3) * 0.4, repeat: Infinity, ease: "easeInOut" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={art}
              alt={p.name}
              draggable={false}
              className="h-full w-full object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,0.45)]"
            />
          </motion.div>
        </div>
      </motion.div>

      {p.cue && p.cue.emote !== "none" && (
        <div key={p.cue.nonce} className="absolute inset-0" style={{ transform: p.flipped ? "scaleX(-1)" : undefined }}>
          <Emote name={p.cue.emote} />
        </div>
      )}
      {p.thinking && <ThinkingDots />}
    </motion.div>
  );
}
