"use client";

import { motion } from "motion/react";
import type { Emote as EmoteName } from "@/lib/types";

/** Manga-style reaction symbols, drawn as SVG so they stay crisp at any size. */
export function Emote({ name }: { name: EmoteName }) {
  switch (name) {
    case "sparkle":
      return (
        <Float className="right-[24%] top-[3%]">
          {[0, 1, 2].map((i) => (
            <motion.svg
              key={i}
              viewBox="0 0 40 40"
              className="absolute"
              style={{ width: 34 - i * 8, left: i * 30, top: i * 22 - 10 }}
              initial={{ scale: 0, rotate: 0 }}
              animate={{ scale: [0, 1.2, 0.9, 1.1, 0], rotate: 90 }}
              transition={{ duration: 1.6, delay: i * 0.15 }}
            >
              <path d="M20 0 L24 16 L40 20 L24 24 L20 40 L16 24 L0 20 L16 16 Z" fill="#fff6b0" stroke="#ffcf3f" strokeWidth={2} />
            </motion.svg>
          ))}
        </Float>
      );
    case "sweat":
      return (
        <Float className="right-[30%] top-[6%]">
          <motion.svg viewBox="0 0 30 44" style={{ width: 30 }}
            initial={{ y: -6, opacity: 0 }} animate={{ y: [-6, 0, 14], opacity: [0, 1, 0] }}
            transition={{ duration: 1.6, times: [0, 0.25, 1] }}>
            <path d="M15 2 C 22 16, 28 24, 28 30 A 13 13 0 0 1 2 30 C 2 24, 8 16, 15 2 Z" fill="#9fdcff" stroke="#3a8fd6" strokeWidth={2.5} />
            <ellipse cx={10} cy={28} rx={3} ry={5} fill="#fff" opacity={0.8} />
          </motion.svg>
        </Float>
      );
    case "heart":
      return (
        <Float className="right-[26%] top-[2%]">
          <motion.svg viewBox="0 0 40 36" style={{ width: 46 }}
            initial={{ scale: 0, y: 10 }} animate={{ scale: [0, 1.3, 1, 1.15, 1], y: -12 }}
            transition={{ duration: 1.2 }}>
            <path d="M20 34 C 4 22, 0 14, 4 7 C 8 0, 17 1, 20 8 C 23 1, 32 0, 36 7 C 40 14, 36 22, 20 34 Z" fill="#ff6fa3" stroke="#d63b74" strokeWidth={2} />
          </motion.svg>
        </Float>
      );
    case "anger":
      return (
        <Float className="right-[28%] top-[4%]">
          <motion.svg viewBox="0 0 40 40" style={{ width: 44 }}
            initial={{ scale: 0 }} animate={{ scale: [0, 1.25, 0.95, 1.2, 1] }} transition={{ duration: 0.9 }}>
            {[0, 90, 180, 270].map((r) => (
              <path key={r} transform={`rotate(${r} 20 20)`} d="M14 4 Q 20 12 26 4" fill="none" stroke="#ff3b3b" strokeWidth={5} strokeLinecap="round" />
            ))}
          </motion.svg>
        </Float>
      );
    case "question":
    case "exclaim":
      return (
        <Float className="right-[27%] top-[0%]">
          <motion.div
            className="font-display text-6xl font-extrabold"
            style={{ color: name === "exclaim" ? "#ffd23f" : "#9fdcff", WebkitTextStroke: "2px #1b1b2b" }}
            initial={{ scale: 0, rotate: -20, y: 10 }}
            animate={{ scale: [0, 1.35, 1], rotate: name === "exclaim" ? 8 : -8, y: 0 }}
            transition={{ duration: 0.45, ease: "backOut" }}
          >
            {name === "exclaim" ? "!" : "?"}
          </motion.div>
        </Float>
      );
    case "music":
      return (
        <Float className="right-[24%] top-[4%]">
          {["♪", "♫"].map((n, i) => (
            <motion.span key={i} className="absolute text-4xl text-sakura"
              style={{ left: i * 28, WebkitTextStroke: "1px #7a2a4a" }}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: [10, -30], x: [0, 10, -6, 8], opacity: [0, 1, 0] }}
              transition={{ duration: 1.8, delay: i * 0.3 }}>{n}</motion.span>
          ))}
        </Float>
      );
    case "blush":
      return (
        <motion.div className="pointer-events-none absolute left-1/2 top-[13.5%] flex -translate-x-1/2 gap-[7%] w-[22%] justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: [0, 0.85, 0.85, 0] }} transition={{ duration: 2.4, times: [0, 0.2, 0.8, 1] }}>
          {[0, 1].map((i) => (
            <div key={i} className="h-[0.9vh] w-[2.6vh] rounded-full bg-[#ff7da8] blur-[2px]" />
          ))}
        </motion.div>
      );
    case "gloom":
      return (
        <motion.div className="pointer-events-none absolute inset-x-[25%] top-0 h-[28%]"
          initial={{ opacity: 0 }} animate={{ opacity: [0, 0.8, 0.8, 0] }} transition={{ duration: 2.4, times: [0, 0.2, 0.8, 1] }}
          style={{ background: "repeating-linear-gradient(90deg, rgba(60,50,120,.55) 0 3px, transparent 3px 14px)", maskImage: "linear-gradient(to bottom, black, transparent)" }} />
      );
    default:
      return null;
  }
}

function Float({ className, children }: { className: string; children: React.ReactNode }) {
  return <div className={`pointer-events-none absolute h-16 w-24 ${className}`}>{children}</div>;
}

/** "…" bubble while the character is thinking about the player's line. */
export function ThinkingDots() {
  return (
    <div className="pointer-events-none absolute right-[22%] top-[4%] flex gap-1.5 rounded-full bg-white/90 px-3 py-2 shadow-lg">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="h-2.5 w-2.5 rounded-full bg-ink/70"
          animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
      ))}
    </div>
  );
}
