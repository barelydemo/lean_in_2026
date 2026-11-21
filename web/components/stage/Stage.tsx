"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { FAR_SLOTS, slots, type StageState } from "@/lib/stage";
import type { Camera, CastMember } from "@/lib/types";
import { Ambient } from "./Ambient";
import { Backdrop } from "./Backdrop";
import { Sprite, type Cue, type ExitDirections } from "./Sprite";
import { TransitionLayer, type TransitionCue } from "./TransitionLayer";

export interface StageCues {
  transition: TransitionCue | null;
  camera: { kind: Camera; nonce: number } | null;
  /** Action/emote for the current speaker. */
  actor: (Cue & { id: string }) | null;
}

interface Props {
  stage: StageState;
  cues: StageCues;
  cast: Record<string, CastMember>;
  thinking: string | null;
}

/** Transitions that cover the screen, so the scene swaps behind them. */
const COVERED = new Set(["fade", "whip"]);

export function Stage({ stage, cues, cast, thinking }: Props) {
  const reduce = useReducedMotion();
  const [scene, setScene] = useState(stage.scene);
  const [camScope, animateCam] = useAnimate<HTMLDivElement>();

  // Swap the backdrop mid-transition when the screen is covered.
  useEffect(() => {
    if (stage.scene === scene) return;
    const covered = cues.transition && COVERED.has(cues.transition.kind);
    const t = setTimeout(() => setScene(stage.scene), covered ? 560 : 0);
    return () => clearTimeout(t);
  }, [stage.scene]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = cues.camera;
    if (!c || reduce || !camScope.current) return;
    if (c.kind === "shake") {
      animateCam(camScope.current, { x: [0, -18, 14, -10, 8, -4, 0], y: [0, 10, -8, 6, -3, 0] }, { duration: 0.55 });
    } else if (c.kind === "tilt_blur") {
      animateCam(camScope.current, { rotate: [4, -1.5, 0], filter: ["blur(10px)", "blur(4px)", "blur(0px)"] }, { duration: 3, ease: "easeOut" });
    }
  }, [cues.camera?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const actor = cues.actor;
  const exits: ExitDirections = {};
  if (actor && (actor.action === "exit_left" || actor.action === "exit_right")) {
    exits[actor.id] = actor.action === "exit_left" ? "left" : "right";
  }

  // People talking with the player share the front; the rest stand back.
  const isNear = (a: (typeof stage.actors)[number]) => a.near || cast[a.id]?.stance === "counter";
  const near = stage.actors.filter(isNear);
  const far = stage.actors.filter((a) => !isNear(a));
  const front = slots(near.length);
  const slotOf = (id: string) => {
    const n = near.findIndex((a) => a.id === id);
    return n >= 0 ? front[n] : FAR_SLOTS[far.findIndex((a) => a.id === id) % FAR_SLOTS.length];
  };
  const someoneSpeaking = !!stage.speaker && stage.actors.some((a) => a.id === stage.speaker);

  return (
    <div className="grain absolute inset-0 overflow-hidden bg-ink">
      <div ref={camScope} className="absolute inset-0">
        <motion.div
          className="absolute inset-0"
          animate={{ scale: stage.zoom, x: `${stage.pan}%` }}
          transition={{ duration: 2.4, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {/* backdrop sits deeper: it moves less than the cast (parallax) */}
          <motion.div className="absolute -inset-[4%]" animate={{ x: `${stage.pan * 0.6}%` }} transition={{ duration: 2.4 }}>
            <AnimatePresence initial={false}>
              <motion.div
                key={scene}
                className="absolute inset-0"
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.1, ease: "easeOut" }}
              >
                <Backdrop scene={scene} />
              </motion.div>
            </AnimatePresence>
          </motion.div>

          <Ambient kind={stage.ambient} />

          <div className="absolute inset-0">
            <AnimatePresence custom={exits}>
              {scene === stage.scene &&
                [...far, ...near].map((a) => {
                  const member = cast[a.id];
                  if (!member) return null;
                  return (
                    <Sprite
                      key={a.id}
                      id={a.id}
                      sprite={member.sprite}
                      poses={member.poses ?? []}
                      counter={member.stance === "counter"}
                      name={member.name}
                      slot={slotOf(a.id)}
                      distant={!isNear(a)}
                      from={a.from}
                      speaking={stage.speaker === a.id}
                      someoneSpeaking={someoneSpeaking}
                      expression={stage.expressions[a.id] ?? "neutral"}
                      flipped={!!stage.flipped[a.id]}
                      cue={actor && actor.id === a.id ? actor : null}
                      thinking={thinking === a.id}
                    />
                  );
                })}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* letterbox gradient so UI text always reads */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-t from-black/35 via-black/10 to-transparent" />

      <TransitionLayer cue={cues.transition} dark={stage.dark} />
    </div>
  );
}
