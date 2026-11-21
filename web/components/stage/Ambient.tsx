"use client";

import { memo } from "react";
import type { Ambient as AmbientName } from "@/lib/types";

// Deterministic pseudo-random so particles don't jump between renders.
const rand = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

const BOKEH = ["#ff8fb7", "#7c6cff", "#ffd88a", "#5fd3ff", "#ff6f6f"];

export const Ambient = memo(function Ambient({ kind }: { kind: AmbientName }) {
  if (kind === "clear" || kind === "keep") return null;
  const count = { rain: 90, snow: 60, petals: 28, night_bokeh: 22, dust: 40 }[kind];

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }, (_, i) => {
        const r1 = rand(i + 1), r2 = rand(i + 101), r3 = rand(i + 201);
        switch (kind) {
          case "rain":
            return <span key={i} className="p-rain" style={{ left: `${r1 * 110}%`, animationDuration: `${0.5 + r2 * 0.4}s`, animationDelay: `${-r3 * 2}s`, opacity: 0.4 + r2 * 0.5 }} />;
          case "snow": {
            const size = 3 + r2 * 6;
            return <span key={i} className="p-snow" style={{ left: `${r1 * 100}%`, width: size, height: size, animationDuration: `${7 + r3 * 8}s`, animationDelay: `${-r3 * 15}s` }} />;
          }
          case "petals":
            return <span key={i} className="p-petal" style={{ left: `${r1 * 110}%`, animationDuration: `${8 + r2 * 7}s`, animationDelay: `${-r3 * 15}s`, scale: `${0.6 + r2 * 0.8}` }} />;
          case "night_bokeh": {
            const size = 30 + r2 * 120;
            return <span key={i} className="p-bokeh" style={{ left: `${r1 * 100}%`, top: `${r3 * 70}%`, width: size, height: size, background: BOKEH[i % BOKEH.length], animationDuration: `${4 + r2 * 5}s`, animationDelay: `${-r1 * 5}s` }} />;
          }
          case "dust":
            return <span key={i} className="p-dust" style={{ left: `${r1 * 100}%`, top: `${20 + r3 * 70}%`, animationDuration: `${4 + r2 * 6}s`, animationDelay: `${-r1 * 8}s` }} />;
        }
      })}
    </div>
  );
});
