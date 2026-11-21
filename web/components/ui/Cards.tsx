"use client";

import { motion } from "motion/react";
import { useEffect } from "react";
import type { GrammarPoint, Lesson, Place } from "@/lib/types";
import { useI18n, type Strings } from "@/lib/i18n";
import type { Difficulty } from "./Settings";

/** The closing word, in the language being learned. */
const FIN: Record<string, { ghost: string; word: string }> = {
  ja: { ghost: "おつかれ", word: "おつかれさま" },
  en: { ghost: "THE END", word: "You made it." },
};

function Overlay({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <motion.div
      className="absolute inset-0 z-40 grid cursor-pointer place-items-center overflow-hidden bg-cream px-6 text-ink"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.7 } }}
      transition={{ duration: 0.7 }}
      onClick={onClick}
    >
      {children}
      <motion.p className="absolute bottom-8 text-sm text-muted"
        animate={{ opacity: [0.35, 0.9, 0.35] }} transition={{ duration: 2.4, repeat: Infinity }}>
        {t.clickToContinue}
      </motion.p>
    </motion.div>
  );
}

/** Huge, faded wordmark behind a card's content. */
function Ghost({ text }: { text: string }) {
  return (
    <motion.span
      className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none whitespace-nowrap text-center font-jp text-[30vw] font-bold leading-none sm:text-[22vw]"
      style={{ background: "linear-gradient(to bottom, rgba(28,29,32,0.07), rgba(28,29,32,0.015))", WebkitBackgroundClip: "text", color: "transparent" }}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.6, ease: "easeOut" }}
    >
      {text}
    </motion.span>
  );
}

// ── Scene Score Card ──────────────────────────────────────────────────────────

export interface SceneStats {
  totalTurns: number;
  voiceTurns: number;          // turns made via microphone
  verdicts: string[];          // coach verdict per turn: "great"|"good"|"understood"|"not_understood"|"english"|"none"
  pronunciationScores?: number[]; // Levenshtein / phonetic match score (0-100) per turn
  revealCount: number;         // how many 👁️ meaning reveals were used
  goalReached: boolean;
  placeId?: string;
  placeName: string;
  placeNameJp: string;
  journal?: string;
  difficulty: Difficulty;
  rewardBattery?: number;
  rewardTrust?: string[];
}

export type Rank = "S" | "A" | "B" | "C";

export const RANK_STYLES: Record<Rank, { bg: string; text: string }> = {
  S: { bg: "bg-shu", text: "text-white" },
  A: { bg: "bg-ink", text: "text-cream" },
  B: { bg: "bg-sky", text: "text-white" },
  C: { bg: "bg-cream-deep", text: "text-ink/60" },
};

/** Score parts, keyed stably so saved diaries keep working; labels come from i18n. */
export type Metric = "pronunciation" | "independence" | "grammar";

function verdictScore(v: string): number {
  return { great: 100, good: 80, understood: 55, not_understood: 20, english: 10, none: 0 }[v] ?? 0;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function computeScore(stats: SceneStats): { rank: Rank; scores: Record<string, number>; total: number } {
  const understood = stats.verdicts.filter((v) => v === "great" || v === "good" || v === "understood").length;
  const fallbackClarity = stats.totalTurns > 0 ? Math.round((understood / stats.totalTurns) * 100) : 0;
  // For Beginner & Intermediate, use the Levenshtein target-phrase similarity scores when recorded.
  const hasPronScores = stats.difficulty !== "advanced" && stats.pronunciationScores && stats.pronunciationScores.length > 0;
  const pronunciationScore = hasPronScores
    ? Math.round(avg(stats.pronunciationScores!))
    : fallbackClarity;
  const grammarScore = Math.round(avg(stats.verdicts.map(verdictScore)));
  const independenceScore = Math.max(0, 100 - stats.revealCount * 15);

  let total: number;
  let scores: Record<string, number>;

  if (stats.difficulty === "beginner") {
    // Beginner: pronunciation only
    scores = { pronunciation: pronunciationScore };
    total = pronunciationScore;
  } else if (stats.difficulty === "intermediate") {
    // Intermediate: pronunciation + hints used
    scores = { pronunciation: pronunciationScore, independence: independenceScore };
    total = Math.round(pronunciationScore * 0.5 + independenceScore * 0.5);
  } else {
    // Advanced: grammar + phrases + pronunciation
    scores = { grammar: grammarScore, pronunciation: pronunciationScore, independence: independenceScore };
    total = Math.round(grammarScore * 0.5 + pronunciationScore * 0.3 + independenceScore * 0.2);
  }

  const rank: Rank = total >= 90 ? "S" : total >= 75 ? "A" : total >= 55 ? "B" : "C";
  return { rank, scores, total };
}

/** A metric's label; diaries saved before metrics had keys show as stored. */
export function metricLabel(t: Strings, key: string): string {
  return (t.metric as Record<string, string>)[key] ?? key;
}

function ScoreBar({ label, value, delay }: { label: string; value: number; delay: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-ink/80">{label}</span>
        <span className="tabular-nums font-medium text-ink">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-cream-deep">
        <motion.div
          className="h-full rounded-full bg-ink"
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.9, delay, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

export function ScoreCard({ stats, onDone, onStayAndDiary }: {
  stats: SceneStats;
  onDone: () => void;
  onStayAndDiary: () => void;
}) {
  const { t } = useI18n();
  const { rank, scores, total } = computeScore(stats);
  const style = RANK_STYLES[rank];
  const defaultBatteryReward = rank === "S" ? 30 : rank === "A" ? 20 : rank === "B" ? 10 : 0;
  const batteryGain = stats.rewardBattery ?? defaultBatteryReward;

  return (
    <motion.div
      className="absolute inset-0 z-40 flex cursor-default items-center justify-center overflow-hidden bg-cream px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.7 } }}
    >
      <Ghost text={stats.placeNameJp} />
      <div className="relative w-full max-w-sm" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="mb-6 text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.25em] text-muted">
            {stats.placeName} · {t.sceneComplete}
          </p>

          {/* Rank badge */}
          <motion.div
            className={`mx-auto mb-3 grid h-20 w-20 place-items-center rounded-full ${style.bg} ${style.text} shadow-lg`}
            initial={{ scale: 0, rotate: -15 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.2 }}
          >
            <span className="text-4xl font-bold">{rank}</span>
          </motion.div>

          <motion.p
            className="tight text-lg font-medium text-ink"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          >
            {t.rank[rank]}
          </motion.p>
          <motion.p
            className="text-sm text-muted"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
          >
            {t.turnsSpoken(stats.totalTurns, stats.voiceTurns)}
          </motion.p>
        </div>

        {/* Score bars */}
        <motion.div
          className="frost space-y-4 rounded-2xl p-5"
          initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}
        >
          {Object.entries(scores).map(([label, val], i) => (
            <ScoreBar key={label} label={metricLabel(t, label)} value={val} delay={0.5 + i * 0.15} />
          ))}

          {/* Divider */}
          <div className="border-t border-hairline pt-3">
            <div className="flex justify-between font-medium">
              <span className="text-sm">{t.totalScore}</span>
              <span className="text-sm">{total} / 100</span>
            </div>
          </div>

          {/* Rewards */}
          <div className="border-t border-hairline pt-3">
            <p className="mb-1.5 text-[11px] uppercase tracking-widest text-muted">{t.rewards}</p>
            {batteryGain > 0 || rank === "S" ? (
              <div className="flex flex-wrap gap-1.5 text-xs font-medium">
                {batteryGain > 0 && <span className="rounded-full bg-cream-deep px-3 py-1">{t.rewardBattery(batteryGain)}</span>}
                {rank === "S" && <span className="rounded-full bg-cream-deep px-3 py-1">{t.rewardTrust}</span>}
              </div>
            ) : (
              <p className="text-xs text-muted">{t.noReward}</p>
            )}
          </div>
        </motion.div>

        {/* Journal quote if goal reached */}
        {stats.journal && (
          <motion.div
            className="mt-4 rounded-2xl border border-hairline px-5 py-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}
          >
            <p className="mb-1 text-[11px] uppercase tracking-widest text-muted">{t.journal}</p>
            <p className="tight text-base italic text-ink/80">“{stats.journal}”</p>
          </motion.div>
        )}

        {/* Action buttons */}
        <motion.div
          className="mt-6 flex flex-col gap-2.5"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }}
        >
          <motion.button
            className="w-full rounded-full bg-ink py-3 text-[15px] font-medium text-cream transition hover:bg-ink/90"
            whileTap={{ scale: 0.97 }}
            onClick={onDone}
          >
            {t.nextScene}
          </motion.button>
          <motion.button
            className="w-full rounded-full border border-hairline bg-cream-deep py-3 text-[15px] font-medium text-ink transition hover:bg-ink/10"
            whileTap={{ scale: 0.97 }}
            onClick={onStayAndDiary}
          >
            {t.openDiary}
          </motion.button>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── Lesson Card ───────────────────────────────────────────────────────────────

/** A Genki lesson finished — what you used, and what's next. */
export function LessonCard({ finished, next, learned, onDone }: {
  finished: Lesson;
  next: Lesson;
  learned: GrammarPoint[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const done = new Set(finished.candos.map((c) => c.id));
  return (
    <Overlay onClick={onDone}>
      <Ghost text={next.title_jp} />
      <div className="relative w-full max-w-xl">
        <span className="rounded-full bg-cream-deep px-3 py-1 text-xs text-muted">{t.lessonComplete(finished.index)}</span>
        <h2 className="tight mt-4 text-5xl font-medium">{finished.title}</h2>
        <p className="mt-6 text-sm text-muted">{t.whatYouCanDo}</p>
        <div className="mt-2 grid gap-2">
          {finished.candos.filter((c) => done.has(c.id)).map((c, i) => (
            <motion.div key={c.id} className="frost flex items-baseline justify-between gap-4 rounded-2xl px-4 py-2.5"
              initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.4 + i * 0.12 }}>
              <span className="tight font-medium">✓ {c.text}</span>
              <span className="text-right font-jp text-sm text-muted">{c.example}</span>
            </motion.div>
          ))}
          {finished.candos.length === 0 && learned.map((g, i) => (
            <motion.div key={g.id} className="frost flex items-baseline justify-between gap-4 rounded-2xl px-4 py-2.5"
              initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.4 + i * 0.12 }}>
              <span className="font-jp text-lg font-medium">{g.pattern}</span>
              <span className="tight text-right text-sm text-muted">{g.meaning}</span>
            </motion.div>
          ))}
        </div>
        <motion.div className="mt-8 rounded-2xl bg-ink px-5 py-4 text-cream"
          initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1 }}>
          <p className="text-xs uppercase tracking-wider text-cream/60">{t.next} · {t.lesson} {next.index}</p>
          <p className="tight mt-1 text-2xl">{next.title} <span className="font-jp text-lg text-cream/70">{next.title_jp}</span></p>
          <p className="mt-1 text-sm text-cream/70">{next.topic}</p>
        </motion.div>
      </div>
    </Overlay>
  );
}

// ── ArrivalCard ───────────────────────────────────────────────────────────────

/**
 * Arriving somewhere: a brief, cinematic place title over the new scene.
 * It moves on by itself so walking around never feels like a menu.
 */
export function ArrivalCard({ place, onDone }: { place: Place; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <motion.div
      className="absolute inset-0 z-40 flex cursor-pointer items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.8 } }}
      onClick={onDone}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/20 to-black/45"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}
      />
      <div className="relative text-center text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.55)]">
        <motion.p className="font-jp text-2xl tracking-[0.3em] text-white/85"
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          {place.name_jp}
        </motion.p>
        <motion.h1 className="tight mt-2 text-5xl font-medium sm:text-7xl"
          initial={{ opacity: 0, letterSpacing: "0.2em" }} animate={{ opacity: 1, letterSpacing: "-0.03em" }}
          transition={{ delay: 0.35, duration: 1 }}>
          {place.name}
        </motion.h1>
        <motion.div className="mx-auto mt-4 h-px w-40 bg-white/70"
          initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.8, duration: 0.7 }} />
        <motion.p className="mt-3 text-sm uppercase tracking-[0.3em] text-white/75"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
          1998 · {place.clock}
        </motion.p>
      </div>
    </motion.div>
  );
}

// ── DemoEndCard ───────────────────────────────────────────────────────────────

/** The end of the beta demo: thanks, and back to the title. */
export function DemoEndCard({ name, onDone }: { name: string; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <motion.div className="absolute inset-0 z-40 grid place-items-center overflow-hidden bg-cream px-6 text-ink"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.6 } }}>
      <Ghost text={t.demo.ghost} />
      <div className="relative max-w-lg text-center">
        <motion.p className="text-[11px] uppercase tracking-[0.25em] text-muted"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>{t.demo.kicker}</motion.p>
        <motion.h2 className="tight mt-3 text-5xl font-medium sm:text-6xl"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.9 }}>
          {t.demo.title}
        </motion.h2>
        <motion.p className="tight mt-4 text-lg leading-relaxed text-ink/75"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}>
          {t.demo.body(name)}
        </motion.p>
        <motion.button onClick={onDone} className="mt-8 rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-cream transition hover:bg-ink/85"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3 }} whileTap={{ scale: 0.97 }}>
          {t.demo.back}
        </motion.button>
      </div>
    </motion.div>
  );
}

// ── FinCard ───────────────────────────────────────────────────────────────────

export function FinCard({ name, onDone }: { name: string; onDone: () => void }) {
  const { t, target } = useI18n();
  const fin = FIN[target] ?? FIN.ja;
  return (
    <Overlay onClick={onDone}>
      <Ghost text={fin.ghost} />
      <div className="relative text-center">
        <motion.p className="font-jp text-6xl font-bold sm:text-7xl"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2 }}>
          {fin.word}
        </motion.p>
        <motion.p className="tight mt-4 text-2xl text-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
          {t.wellDone(name)}
        </motion.p>
      </div>
    </Overlay>
  );
}
