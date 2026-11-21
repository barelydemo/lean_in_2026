"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { CastMember, DiaryEntry, DiaryLineFeedback, GrammarPoint, Line } from "@/lib/types";
import { NARRATOR, PLAYER } from "@/lib/types";
import { RANK_STYLES, type Rank } from "./Cards";

const VERDICT_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  great: { label: "Great!", bg: "bg-emerald-100", text: "text-emerald-800" },
  good: { label: "Good", bg: "bg-teal-100", text: "text-teal-800" },
  understood: { label: "Understood", bg: "bg-sky-100", text: "text-sky-800" },
  not_understood: { label: "Not quite", bg: "bg-amber-100", text: "text-amber-800" },
  english: { label: "English used", bg: "bg-rose-100", text: "text-rose-800" },
  none: { label: "Spoken", bg: "bg-zinc-100", text: "text-zinc-700" },
};

function normalizeLine(raw: [number, Omit<Line, "id">] | Line): Line {
  if (Array.isArray(raw)) {
    const [id, beat] = raw;
    return { id, ...beat };
  }
  return raw;
}

function formatDate(ts: number): string {
  if (!ts) return "Just now";
  try {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function DiaryPanel({
  open,
  onClose,
  sceneEnded = false,
  onNextScene,
  entries,
  playerName,
  cast,
  grammar,
}: {
  open: boolean;
  onClose: () => void;
  sceneEnded?: boolean;
  onNextScene?: () => void;
  entries: DiaryEntry[];
  playerName: string;
  cast: Record<string, CastMember>;
  grammar: Record<string, GrammarPoint>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Select the latest completed scene whenever the diary opens
  useEffect(() => {
    if (open && entries.length > 0) {
      setSelectedId(entries[entries.length - 1].id);
    }
  }, [open, entries]);

  const active = entries.find((e) => e.id === selectedId) ?? entries[entries.length - 1] ?? null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="absolute inset-0 z-40 bg-ink/35 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="absolute inset-y-0 right-0 z-50 flex w-[min(42rem,100vw)] flex-col bg-cream text-ink shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 220, damping: 28 }}
          >
            {/* Header */}
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-6 pb-4 pt-6">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-muted">Conversation &amp; Score Log</p>
                <h2 className="tight mt-0.5 text-3xl font-medium">Traveler&apos;s Diary 📖</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  aria-label="Close diary"
                  className="rounded-full bg-cream-deep px-4 py-1.5 text-sm font-medium text-ink/80 transition hover:bg-ink hover:text-cream"
                >
                  {sceneEnded ? "← Back to Scorecard" : "Back to Scene ×"}
                </button>
                {sceneEnded && onNextScene && (
                  <button
                    onClick={onNextScene}
                    className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-cream transition hover:bg-ink/90"
                  >
                    Next Scene →
                  </button>
                )}
              </div>
            </header>

            {entries.length === 0 ? (
              <div className="grid flex-1 place-items-center px-8 text-center">
                <div className="max-w-sm space-y-2">
                  <p className="text-3xl">📖</p>
                  <p className="tight text-xl font-medium text-ink">No completed scenes yet</p>
                  <p className="text-sm text-muted">
                    Finish a scene&apos;s goal or reach your turn budget to record your first scorecard, dialogue transcript, and Sensei feedback here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* Scene selector pills */}
                <div className="flex gap-2 overflow-x-auto border-b border-hairline bg-cream-deep/50 px-6 py-3">
                  {entries.map((entry, idx) => {
                    const r = (entry.rank in RANK_STYLES ? entry.rank : "C") as Rank;
                    const rStyle = RANK_STYLES[r];
                    const isSelected = active?.id === entry.id;
                    return (
                      <button
                        key={entry.id}
                        onClick={() => setSelectedId(entry.id)}
                        className={`flex shrink-0 items-center gap-2 rounded-2xl px-3.5 py-2 text-left transition ${
                          isSelected
                            ? "bg-ink text-cream shadow-md"
                            : "bg-cream text-ink/75 hover:bg-white hover:text-ink"
                        }`}
                      >
                        <span
                          className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${rStyle.bg} ${rStyle.text}`}
                        >
                          {r}
                        </span>
                        <div>
                          <p className="text-xs font-medium leading-tight">
                            {idx + 1}. {entry.place_name}
                          </p>
                          <p className={`text-[10px] ${isSelected ? "text-cream/65" : "text-muted"}`}>
                            {entry.score}/100 · {entry.turns_used}t
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Active Scene Details */}
                {active && (
                  <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
                    {/* Summary card */}
                    <div className="rounded-2xl border border-hairline bg-white/75 p-5 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex items-baseline gap-2">
                            <h3 className="tight text-2xl font-medium">{active.place_name}</h3>
                            <span className="font-jp text-base text-muted">{active.place_name_jp}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted">
                            {formatDate(active.created_at)} · {active.turns_used} turns ({active.voice_turns} spoken) ·{" "}
                            <span className="capitalize">{active.difficulty}</span> mode
                          </p>
                        </div>

                        {(() => {
                          const r = (active.rank in RANK_STYLES ? active.rank : "C") as Rank;
                          const style = RANK_STYLES[r];
                          return (
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <p className="text-xs uppercase tracking-wider text-muted">Final Score</p>
                                <p className="text-xl font-bold text-ink">{active.score} / 100</p>
                              </div>
                              <div
                                className={`grid h-12 w-12 place-items-center rounded-full text-2xl font-bold shadow ${style.bg} ${style.text}`}
                              >
                                {r}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Metric breakdowns */}
                      {Object.keys(active.metrics ?? {}).length > 0 && (
                        <div className="mt-4 space-y-2.5 border-t border-hairline pt-4">
                          {Object.entries(active.metrics).map(([label, val]) => (
                            <div key={label} className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="text-ink/80">{label}</span>
                                <span className="tabular-nums font-medium">{val}%</span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-cream-deep">
                                <div
                                  className="h-full rounded-full bg-ink transition-all"
                                  style={{ width: `${Math.min(100, Math.max(0, val))}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Rewards earned */}
                      {(active.reward_battery > 0 || (active.reward_trust?.length ?? 0) > 0) && (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-3 text-xs font-medium">
                          {active.reward_battery > 0 && (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-emerald-800">
                              🔋 +{active.reward_battery}% Battery
                            </span>
                          )}
                          {(active.reward_trust?.length ?? 0) > 0 && (
                            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-amber-900">
                              🤝 +1 Trust ({active.reward_trust.map((id) => cast[id]?.name ?? id).join(", ")})
                            </span>
                          )}
                        </div>
                      )}

                      {active.journal && (
                        <p className="mt-3 border-t border-hairline pt-3 text-sm italic text-ink/80">
                          &ldquo;{active.journal}&rdquo;
                        </p>
                      )}
                    </div>

                    {/* Dialogue Backlog + Line-by-Line Coach Feedback */}
                    <div>
                      <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                        Scene Dialogue &amp; Sensei Feedback
                      </h4>
                      <ul className="space-y-3">
                        {active.lines.map((raw, idx) => {
                          const l = normalizeLine(raw);
                          const isPlayer = l.speaker === PLAYER;
                          const isNarrator = l.speaker === NARRATOR;
                          const who = isNarrator
                            ? ""
                            : isPlayer
                              ? playerName
                              : cast[l.speaker]?.name ?? l.speaker_name ?? l.speaker;
                          const color = isPlayer ? "#c8202f" : cast[l.speaker]?.color ?? "#555";

                          const fb: DiaryLineFeedback | undefined = isPlayer
                            ? active.feedbacks?.find((f) => f.line_id === l.id)
                            : undefined;
                          const badge = fb ? VERDICT_BADGE[fb.verdict] ?? VERDICT_BADGE.none : null;

                          if (isNarrator) {
                            return (
                              <li key={`${l.id}-${idx}`} className="px-2 py-1 text-sm italic text-ink/65">
                                {l.en}
                              </li>
                            );
                          }

                          return (
                            <li
                              key={`${l.id}-${idx}`}
                              className={`rounded-2xl px-4 py-3 ${
                                isPlayer
                                  ? "border border-shu/25 bg-shu/[0.04]"
                                  : "bg-ink/[0.04]"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className="text-xs font-semibold uppercase tracking-wider"
                                  style={{ color }}
                                >
                                  {who} {isPlayer && "(You)"}
                                </span>
                                {badge && (
                                  <span
                                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${badge.bg} ${badge.text}`}
                                  >
                                    {badge.label}
                                  </span>
                                )}
                              </div>

                              {l.jp && <p className="mt-1 font-jp text-lg font-medium text-ink">{l.jp}</p>}
                              {l.romaji && <p className="text-xs text-shu/90">{l.romaji}</p>}
                              {l.en && <p className="mt-0.5 text-sm text-ink/70">&ldquo;{l.en}&rdquo;</p>}

                              {/* Line-by-line Sensei feedback */}
                              {fb && (fb.note || fb.better_jp || (fb.grammar_used?.length ?? 0) > 0) && (
                                <div className="mt-2.5 rounded-xl bg-white/85 px-3.5 py-2.5 text-xs shadow-xs">
                                  <p className="font-semibold uppercase tracking-wider text-muted">
                                    Sensei Feedback
                                  </p>
                                  {fb.note && <p className="mt-1 text-sm text-ink/85">{fb.note}</p>}
                                  {fb.better_jp && (
                                    <div className="mt-2 border-t border-hairline pt-2">
                                      <span className="text-[10px] uppercase tracking-wider text-muted">
                                        Suggested phrasing:
                                      </span>
                                      <p className="font-jp text-base font-medium text-ink">{fb.better_jp}</p>
                                      {fb.better_romaji && (
                                        <p className="text-xs text-shu">{fb.better_romaji}</p>
                                      )}
                                      {fb.better_en && (
                                        <p className="text-xs text-ink/70">&ldquo;{fb.better_en}&rdquo;</p>
                                      )}
                                    </div>
                                  )}
                                  {fb.grammar_used && fb.grammar_used.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {fb.grammar_used.map((gid) => (
                                        <span
                                          key={gid}
                                          className="rounded-full bg-shu px-2 py-0.5 font-jp text-[10px] text-white"
                                        >
                                          ✓ {grammar[gid]?.pattern ?? gid}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
