"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Line } from "@/lib/types";
import { NARRATOR, PLAYER, THOUGHT } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Waveform } from "./Frame";

/** "immersion": no translations except via the translator and known words. */
export type Assist = "full" | "hint" | "immersion";

type Known = Record<string, { romaji: string; en: string; mastered?: boolean; kind?: string; uses?: number }>;

interface Seg {
  text: string;
  /** Gloss for a looked-up word, fading as the player uses it. */
  en?: string;
  uses?: number;
  /** A key word met in this place but not yet looked up. */
  seen?: boolean;
}

const isLatin = (c: string | undefined) => !!c && /[a-z0-9']/i.test(c);

/**
 * Splits a line into plain text, words the player has looked up (longest
 * match first) and key words they've met but not looked up yet. Latin
 * words match whole words only, ignoring case.
 */
function segment(text: string, known: Known, seen: string[]): Seg[] {
  // Owned words and particles read as plain text: the player knows them.
  const glossed = Object.keys(known).filter((w) => w.length > 0 && !known[w].mastered && known[w].kind !== "particle");
  const outlined = seen.filter((w) => w.length > 1 && !(w in known));
  const words = [...glossed, ...outlined].sort((x, y) => y.length - x.length);
  if (!words.length) return [{ text }];
  const lower = text.toLowerCase();
  const at = (w: string, i: number) =>
    lower.startsWith(w.toLowerCase(), i) &&
    (!isLatin(w[0]) || (!isLatin(text[i - 1]) && !isLatin(text[i + w.length])));
  const out: Seg[] = [];
  let i = 0;
  let plain = "";
  while (i < text.length) {
    const hit = words.find((w) => at(w, i));
    if (hit) {
      if (plain) out.push({ text: plain });
      plain = "";
      const piece = text.slice(i, i + hit.length);
      const k = known[hit];
      // First sense only, so the gloss stays short under the word.
      out.push(k ? { text: piece, en: k.en.split(/[/;,]/)[0].trim(), uses: k.uses ?? 0 } : { text: piece, seen: true });
      i += hit.length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  if (plain) out.push({ text: plain });
  return out;
}

/** Glosses fade as a word gets used: full, then faint, then hover-only. */
const GLOSS_OPACITY = ["opacity-100", "opacity-60", "opacity-0 group-hover:opacity-70"];

interface Props {
  line: Line;
  name: string;
  nameJp?: string;
  color: string;
  assist: Assist;
  charsPerSecond: number;
  /** Bumped by the parent (Enter key) to finish the typewriter instantly. */
  skip: number;
  speaking: boolean;
  /** Words revealed by the translator; glossed inline in immersion mode. */
  known?: Known;
  /** Key words met but not looked up: outlined, no gloss. */
  seen?: string[];
  /** Called as characters appear, for the typewriter sound. */
  onTick?: () => void;
  onTyped: () => void;
  onAdvance: () => void;
  canAdvance: boolean;
  dimmed?: boolean;
}

export function DialogueBox(p: Props) {
  const isThought = p.line.speaker === THOUGHT;
  const isNarration = p.line.speaker === NARRATOR || isThought;
  const isPlayer = p.line.speaker === PLAYER;
  const tone = isNarration ? "narration" : isPlayer ? "player" : "character";

  return (
    <motion.div
      onClick={p.canAdvance ? p.onAdvance : undefined}
      className={`relative mx-auto w-full cursor-pointer px-3 sm:px-6 ${tone === "narration" ? "max-w-2xl" : "max-w-3xl"}`}
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: p.dimmed ? 0.6 : 1, scale: p.dimmed ? 0.97 : 1 }}
      transition={{ type: "spring", stiffness: 170, damping: 22 }}
    >
      <motion.div
        layout
        className={`relative overflow-hidden rounded-[22px] px-5 pb-4 pt-3 sm:px-7 ${
          tone === "character" ? "frost text-ink" : tone === "player" ? "ml-auto max-w-xl bg-ink/88 text-cream shadow-2xl backdrop-blur-xl" : "smoke text-center"
        }`}
      >
        {tone !== "narration" && (
          <div className="flex items-center justify-between gap-3 border-b pb-2.5"
            style={{ borderColor: tone === "player" ? "rgba(255,255,255,0.12)" : "rgba(28,29,32,0.08)" }}>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
              <span className="tight text-[15px] font-semibold">{p.name}</span>
              {p.nameJp && <span className="font-jp text-xs opacity-55">{p.nameJp}</span>}
            </span>
            <Waveform active={p.speaking} light={tone === "player"} />
          </div>
        )}
        {isThought && <p className="pt-1 text-[11px] uppercase tracking-[0.18em] text-white/50">{p.name}</p>}
        <LineBody key={p.line.id} {...p} tone={tone} thought={isThought} />
      </motion.div>
    </motion.div>
  );
}

/** Typewriter state lives here, keyed by line id, so each line starts fresh. */
function LineBody({ line, assist, charsPerSecond, skip, known, seen, onTick, onTyped, canAdvance, tone, thought }: Props & { tone: string; thought: boolean }) {
  const primary = tone === "narration" ? line.en ?? "" : line.jp || line.en || "";
  const [shown, setShown] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [skipAt] = useState(skip);
  const done = shown >= primary.length || skip !== skipAt;
  const visible = done ? primary.length : shown;

  useEffect(() => {
    if (!primary) return;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(i);
      if (i % 2 === 0 && primary[i] !== " ") onTick?.();
      if (i >= primary.length) clearInterval(t);
    }, 1000 / charsPerSecond);
    return () => clearInterval(t);
  }, [primary, charsPerSecond]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (done) onTyped();
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const { t } = useI18n();

  // A line spoken in the player's own language needs no translation under it.
  const plain = (t?: string) => (t ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const inOwnLanguage = !line.romaji && plain(line.jp) === plain(line.en);
  const hasTranslation = tone !== "narration" && !!line.jp && !inOwnLanguage && (!!line.en || !!line.romaji);
  const showHelp = assist === "full" || reveal;



  return (
    <div className="relative pt-2.5">
      <p
        className={
          tone === "narration"
            ? `text-[17px] leading-relaxed text-white/95 sm:text-lg ${thought ? "italic" : ""}`
            : "font-jp text-[1.55rem] font-medium leading-snug sm:text-[1.8rem]"
        }
      >
        {tone === "character" && assist === "immersion" && known ? (
          <Glossed text={primary} visible={visible} known={known} seen={seen ?? []} />
        ) : (
          <>
            {primary.slice(0, visible)}
            <span className="invisible">{primary.slice(visible)}</span>
          </>
        )}
      </p>

      <AnimatePresence>
        {(done || assist === "full") && hasTranslation && showHelp && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1">
            {line.romaji && <p className="text-sm opacity-50">{line.romaji}</p>}
            {line.en && <p className="tight text-[15px] opacity-80 sm:text-base">{line.en}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {done && hasTranslation && !showHelp && assist !== "immersion" && (
        <button
          className="mt-2 rounded-full border border-current/15 px-3 py-0.5 text-xs opacity-60 hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); setReveal(true); }}
        >
          {t.showTranslation}
        </button>
      )}

      {canAdvance && (
        <div className="mt-1.5 flex h-4 justify-end">
          {done && (
            <motion.span className="flex items-center gap-1 text-[11px] opacity-55"
              animate={{ opacity: [0.35, 0.75, 0.35] }} transition={{ duration: 2, repeat: Infinity }}>
              {t.clickToContinue} <span aria-hidden>▼</span>
            </motion.span>
          )}
        </div>
      )}
    </div>
  );
}

/** A line with looked-up words glossed and met words outlined. */
function Glossed({ text, visible, known, seen }: { text: string; visible: number; known: Known; seen: string[] }) {
  const segs = segment(text, known, seen);
  const starts = segs.map((_, i) => segs.slice(0, i).reduce((n, x) => n + x.text.length, 0));
  return (
    <>
      {segs.map((seg, i) => {
        const start = starts[i];
        const shownPart = seg.text.slice(0, Math.max(0, visible - start));
        const hidden = seg.text.slice(shownPart.length);
        const body = (
          <>
            {shownPart}
            <span className="invisible">{hidden}</span>
          </>
        );
        if (seg.seen) {
          return <span key={i} className="rounded-[4px] outline-1 outline-offset-1 outline-dashed outline-ink/25">{body}</span>;
        }
        if (!seg.en) return <span key={i}>{body}</span>;
        const fade = GLOSS_OPACITY[Math.min(seg.uses ?? 0, GLOSS_OPACITY.length - 1)];
        return (
          <ruby key={i} className="group [ruby-position:under]">
            <span className="decoration-shu/50 underline decoration-dotted underline-offset-4">{body}</span>
            <rt className={`whitespace-nowrap font-sans text-[11px] font-medium tracking-normal text-shu transition-opacity ${hidden ? "opacity-0" : fade}`}>
              {seg.en}
            </rt>
          </ruby>
        );
      })}
    </>
  );
}
