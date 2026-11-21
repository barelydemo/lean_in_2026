"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { CastMember, Line, Run, Story } from "@/lib/types";
import { NARRATOR, OWN_AFTER, PLAYER } from "@/lib/types";

import { useI18n } from "@/lib/i18n";

type Tab = "words" | "curriculum" | "phrases" | "journal" | "backlog";

export function Notebook({ open, onClose, story, run, backlog, cast }: {
  open: boolean;
  onClose: () => void;
  story: Story;
  run: Run;
  backlog: Line[];
  cast: Record<string, CastMember>;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("words");
  const tabLabel: Record<Tab, string> = {
    words: t.tabWords, curriculum: t.tabCurriculum, phrases: t.tabPhrases, journal: t.tabJournal, backlog: t.tabBacklog,
  };
  const s = run.state;
  const candosDone = new Set(s.candos_done ?? []);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="absolute inset-0 z-40 bg-ink/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="absolute inset-y-0 right-0 z-50 flex w-[min(34rem,100vw)] flex-col bg-cream text-ink shadow-2xl"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 220, damping: 28 }}
          >
            <header className="flex items-center justify-between px-6 pb-2 pt-6">
              <h2 className="tight text-3xl font-medium">{t.notebook}</h2>
              <button onClick={onClose} aria-label={t.close} className="rounded-full px-3 py-1 text-2xl text-ink/50 hover:bg-ink/5">×</button>
            </header>
            <nav className="flex gap-1 px-5">
              {(["words", "curriculum", "phrases", "journal", "backlog"] as Tab[]).map((k) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`relative rounded-full px-3 py-1.5 text-sm capitalize ${tab === k ? "text-white" : "text-ink/60 hover:text-ink"}`}>
                  {tab === k && <motion.span layoutId="tab" className="absolute inset-0 -z-0 rounded-full bg-ink" />}
                  <span className="relative">{tabLabel[k]}</span>
                </button>
              ))}
            </nav>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {tab === "words" && (() => {
                const words = Object.entries(s.known_words).filter(([, w]) => w.kind !== "particle");
                const done = words.filter(([, w]) => w.mastered).length;
                return (
                  <div>
                    <p className="text-sm text-ink/60">{t.wordsIntro(done, words.length)}</p>
                    {words.length === 0 && <p className="mt-4 text-ink/50">{t.noWords}</p>}
                    <ul className="mt-4 grid grid-cols-2 gap-2">
                      {words.sort(([, a], [, b]) => Number(b.mastered) - Number(a.mastered) || (b.uses ?? 0) - (a.uses ?? 0)).map(([jp, w]) => (
                        <li key={jp} className={`rounded-xl px-3 py-2 ${w.mastered ? "bg-ink text-cream" : "bg-ink/[0.04]"}`}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-jp text-lg">{jp}</span>
                            <span className="text-[10px] uppercase tracking-wider opacity-60">{w.mastered ? t.owned : (t.kinds as Record<string, string>)[w.kind] ?? w.kind}</span>
                          </div>
                          <p className="text-xs opacity-60">{w.romaji}</p>
                          <p className="text-sm">{w.en}</p>
                          {!w.mastered && (
                            <span className="mt-1 flex gap-0.5" title={t.uses(w.uses ?? 0)}>
                              {Array.from({ length: OWN_AFTER }, (_, k) => (
                                <span key={k} className={`h-1.5 w-3 rounded-full ${(w.uses ?? 0) > k ? "bg-shu" : "bg-ink/15"}`} />
                              ))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {tab === "curriculum" && (
                <div className="space-y-6">
                  <p className="text-sm text-ink/60">{t.curriculumIntro}</p>
                  {story.lessons.map((ch, i) => {
                    const locked = i > s.lesson_idx;
                    return (
                      <section key={ch.index} className={locked ? "opacity-40" : ""}>
                        <h3 className="flex items-baseline gap-2">
                          <span className="rounded bg-ink/10 px-1.5 text-[11px] font-semibold">L{ch.index}</span>
                          <span className="tight text-lg font-semibold">{ch.title}</span>
                          <span className="font-jp text-sm text-ink/50">{ch.title_jp}</span>
                          <span className="text-sm text-ink/50">{locked ? `· ${t.locked}` : i === s.lesson_idx ? `· ${t.now}` : "· ✓"}</span>
                        </h3>
                        {!locked && ch.candos.length > 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {ch.candos.map((c) => (
                              <li key={c.id} className="rounded-xl bg-ink/[0.04] px-3 py-2">
                                <p className={`tight font-medium ${candosDone.has(c.id) ? "" : "text-ink/70"}`}>
                                  <span className={candosDone.has(c.id) ? "text-shu" : "text-ink/30"}>{candosDone.has(c.id) ? "✓" : "○"}</span> {c.text}
                                </p>
                                <p className="mt-0.5 font-jp text-sm">{c.example} <span className="text-ink/45">— {c.example_reading}</span></p>
                              </li>
                            ))}
                          </ul>
                        )}
                        {!locked && ch.candos.length === 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {ch.grammar.map((g) => {
                              const n = s.grammar_counts[g.id] ?? 0;
                              return (
                                <li key={g.id} className="rounded-xl bg-ink/[0.04] px-3 py-2">
                                  <div className="flex items-baseline justify-between gap-3">
                                    <span className="font-jp font-semibold">{g.pattern}</span>
                                    <span className="flex gap-0.5">
                                      {[0, 1, 2].map((k) => (
                                        <span key={k} className={`h-2 w-2 rounded-full ${n > k ? "bg-shu" : "bg-ink/15"}`} />
                                      ))}
                                    </span>
                                  </div>
                                  <p className="text-sm text-ink/60">{g.meaning}</p>
                                  <p className="mt-0.5 font-jp text-sm">{g.example_jp} <span className="text-ink/45">— {g.example_en}</span></p>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}

              {tab === "phrases" && (
                <ul className="space-y-2">
                  {run.phrases.length === 0 && <p className="text-ink/50">{t.noPhrases}</p>}
                  {run.phrases.map((p) => (
                    <li key={p.jp} className="rounded-xl bg-ink/[0.04] px-3 py-2">
                      <p className="font-jp text-lg">{p.jp}</p>
                      <p className="text-sm text-ink/55">{p.romaji} · {p.en}</p>
                    </li>
                  ))}
                </ul>
              )}

              {tab === "journal" && (
                <div className="space-y-5">
                  {run.journal.length === 0 && <p className="text-ink/50">{t.noJournal}</p>}
                  {run.journal.map((j) => (
                    <article key={j.seq}>
                      <h3 className="text-xs uppercase tracking-wider text-ink/50">{t.entry(j.seq)}</h3>
                      <p className="mt-1 leading-relaxed text-ink/80">“{j.text}”</p>
                    </article>
                  ))}
                </div>
              )}

              {tab === "backlog" && (
                <ul className="space-y-3">
                  {backlog.map((l) => {
                    const who = l.speaker === NARRATOR ? "" : l.speaker === PLAYER ? s.player_name : cast[l.speaker]?.name ?? l.speaker_name;
                    return (
                      <li key={l.id}>
                        {who && <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: cast[l.speaker]?.color ?? "#555" }}>{who}</p>}
                        {l.speaker === NARRATOR ? (
                          <p className="italic text-ink/70">{l.en}</p>
                        ) : (
                          <>
                            <p className="font-jp text-lg">{l.jp}</p>
                            {l.en && <p className="text-sm text-ink/55">{l.en}</p>}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
