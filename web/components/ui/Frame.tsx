"use client";

import type { ReactNode } from "react";

type Corner = "tl" | "tr" | "bl" | "br";

/**
 * A cream "notch" cut into the corner of a framed scene. The tab is drawn
 * in the page colour, with a soft S-curve ramp back into the frame edge.
 */
export function NotchTab({ corner, children, className = "" }: { corner: Corner; children: ReactNode; className?: string }) {
  const top = corner[0] === "t";
  const left = corner[1] === "l";
  // The ramp sits on the inner side of the tab and is mirrored per corner.
  const ramp = (
    <svg
      viewBox="0 0 44 44"
      preserveAspectRatio="none"
      className="h-full w-11 shrink-0 text-cream"
      style={{ transform: `scale(${left ? 1 : -1}, ${top ? 1 : -1})` }}
      aria-hidden
    >
      <path d="M0 0 H6 C 20 0, 24 44, 44 44 H0 Z" fill="currentColor" />
    </svg>
  );
  return (
    <div
      className={`absolute z-20 flex ${top ? "top-0" : "bottom-0"} ${left ? "left-0 flex-row" : "right-0 flex-row-reverse"} ${className}`}
    >
      <div
        className={`flex items-center gap-3 bg-cream px-4 ${top ? "pb-2 pt-1.5" : "pb-1.5 pt-2"} ${
          top ? (left ? "rounded-br-2xl" : "rounded-bl-2xl") : left ? "rounded-tr-2xl" : "rounded-tl-2xl"
        }`}
      >
        {children}
      </div>
      {ramp}
    </div>
  );
}

/** The brand mark: a vermilion hanko-style seal and wordmark. */
export function Mark({ small }: { small?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={`grid place-items-center rounded-[9px] bg-shu font-jp font-bold text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.2)] ${small ? "h-7 w-7 text-sm" : "h-8 w-8 text-base"}`}
      >
        迷
      </span>
      <span className={`tight font-semibold ${small ? "text-base" : "text-lg"}`}>Lexical</span>
    </span>
  );
}

/** Round vermilion arrow, used inside primary pill buttons. */
export function ArrowDot({ dark }: { dark?: boolean }) {
  return (
    <span className={`grid h-8 w-8 place-items-center rounded-full ${dark ? "bg-ink" : "bg-shu"} text-white`}>
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M5 11 L11 5 M6 5 H11 V10" />
      </svg>
    </span>
  );
}

export function PillButton({ children, onClick, disabled, type = "button", tone = "light" }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  tone?: "light" | "dark";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`group flex items-center gap-3 rounded-full py-1.5 pl-5 pr-1.5 text-[15px] font-medium shadow-[0_6px_24px_rgba(28,29,32,0.14)] ring-4 transition hover:-translate-y-0.5 disabled:opacity-50 ${
        tone === "light" ? "bg-cream text-ink ring-white/50" : "bg-ink text-cream ring-ink/10"
      }`}
    >
      {children}
      <span className="transition-transform group-hover:rotate-45">
        <ArrowDot dark={tone === "dark"} />
      </span>
    </button>
  );
}

/** Animated voice waveform glyph, like a voice message. */
export function Waveform({ active, light, bars = 15 }: { active: boolean; light?: boolean; bars?: number }) {
  return (
    <span className="flex h-6 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const h = [0.3, 0.6, 0.45, 1, 0.5, 0.8, 0.35, 0.9, 0.55, 0.7, 0.4, 1, 0.5, 0.75, 0.3][i % 15];
        return (
          <span
            key={i}
            className={`w-[2.5px] rounded-full ${light ? "bg-white" : "bg-ink"}`}
            style={{
              height: `${h * 100}%`,
              opacity: active ? 0.9 : 0.35,
              animation: active ? `wave 0.9s ${i * 0.06}s ease-in-out infinite alternate` : undefined,
            }}
          />
        );
      })}
      <style>{`@keyframes wave { from { transform: scaleY(.35) } to { transform: scaleY(1) } }`}</style>
    </span>
  );
}

export function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <circle cx="10" cy="10" r="8" />
      <path d="M10 5.5 V10 L13 12" strokeLinecap="round" />
    </svg>
  );
}

export function PinIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <circle cx="10" cy="6.5" r="3.5" />
      <path d="M3 18 C 4 13.5, 7 12, 10 12 S 16 13.5, 17 18" strokeLinecap="round" />
    </svg>
  );
}
