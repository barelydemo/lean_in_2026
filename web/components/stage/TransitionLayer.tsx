"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Transition } from "@/lib/types";

export interface TransitionCue {
  kind: Transition;
  nonce: number;
}

/** Full-screen transition effects, layered above the stage. */
export function TransitionLayer({ cue, dark }: { cue: TransitionCue | null; dark: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* blackout persists until a later transition lifts it */}
      <motion.div
        className="absolute inset-0 bg-black"
        initial={false}
        animate={{ opacity: dark ? 1 : 0 }}
        transition={{ duration: dark ? 0.25 : 1.2 }}
      />
      <AnimatePresence>
        {cue && cue.kind !== "none" && cue.kind !== "blackout" && cue.kind !== "crossfade" && (
          <Effect key={cue.nonce} kind={cue.kind} />
        )}
      </AnimatePresence>
    </div>
  );
}

function Effect({ kind }: { kind: Transition }) {
  switch (kind) {
    case "flash":
      return (
        <motion.div className="absolute inset-0 bg-white"
          initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.7, times: [0, 0.12, 1] }} />
      );
    case "fade":
      return (
        <motion.div className="absolute inset-0 bg-black"
          initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 1.5, times: [0, 0.35, 0.5, 1] }} />
      );
    case "whip":
      return (
        <motion.div className="absolute inset-y-0 w-[60%]"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,.9) 40%, rgba(255,255,255,.95) 60%, transparent)", filter: "blur(30px)" }}
          initial={{ left: "-70%" }} animate={{ left: "120%" }} transition={{ duration: 0.65, ease: [0.7, 0, 0.3, 1] }} />
      );
    case "wake":
      // Eyelids: closed → flutter → open.
      return (
        <>
          {(["top", "bottom"] as const).map((side) => (
            <motion.div key={side} className="absolute inset-x-0 h-1/2 bg-black"
              style={{ [side]: 0, borderRadius: side === "top" ? "0 0 50% 50% / 0 0 30% 30%" : "50% 50% 0 0 / 30% 30% 0 0" }}
              initial={{ y: "0%" }}
              animate={{ y: side === "top" ? ["0%", "-55%", "-10%", "-70%", "-30%", "-110%"] : ["0%", "55%", "10%", "70%", "30%", "110%"] }}
              transition={{ duration: 3.2, times: [0, 0.2, 0.35, 0.55, 0.68, 1], ease: "easeInOut" }} />
          ))}
        </>
      );
    default:
      return null;
  }
}
