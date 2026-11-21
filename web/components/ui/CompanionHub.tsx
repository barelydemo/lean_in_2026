"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { CastMember, DiaryEntry, FlowBranch, FlowQuest, DiaryLineFeedback, GrammarPoint, Lesson, Line, Place, Run, Story, UnlockedSkill } from "@/lib/types";
import { NARRATOR, OWN_AFTER, PLAYER } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { metricLabel, RANK_STYLES, type Rank } from "./Cards";

export type HubTab = "story" | "people" | "places" | "progress" | "diary" | "log";

const TABS: HubTab[] = ["story", "progress", "people", "places", "diary", "log"];
const TRUST_RANGE = 10;

/** Skill-tree node ids: one per lesson (server: game::lesson_node_id). */
export const lessonNodeId = (index: number) => `lesson_${index}`;

function normalizeLine(raw: [number, Omit<Line, "id">] | Line): Line {
  if (Array.isArray(raw)) {
    const [id, beat] = raw;
    return { id, ...beat };
  }
  return raw;
}

function formatDate(ts: number, locale: string): string {
  if (!ts) return "";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  try {
    return new Date(ms).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function rankOf(r: string): Rank {
  return (r in RANK_STYLES ? r : "C") as Rank;
}

/**
 * The traveller's notebook: who you've met, where you've been, what you can
 * do, scene debriefs and everything said. It reads only what the player has
 * earned — places and words stay hidden until met.
 */
export function CompanionHub({
  open,
  initialTab = "progress",
  initialSkillNodeId = null,
  mode = "ingame",
  story,
  run,
  entries,
  backlog,
  cast,
  grammar,
  onClose,
  onEnterScene,
  onNextScene,
  onTravel,
  onReplayLine,
  onPreviewVoice,
}: {
  open: boolean;
  initialTab?: HubTab;
  initialSkillNodeId?: string | null;
  /** "resume" from the title screen's Continue; "scorecard" at a scene's end; "ingame" during play. */
  mode?: "resume" | "scorecard" | "ingame";
  story: Story;
  run: Run;
  entries: DiaryEntry[];
  backlog: Line[];
  cast: Record<string, CastMember>;
  grammar: Record<string, GrammarPoint>;
  onClose: () => void;
  onEnterScene?: () => void;
  onNextScene?: () => void;
  onTravel?: (to: string) => void;
  onReplayLine?: (line: Line) => void;
  onPreviewVoice?: (text: string, speakerId?: string) => void;
}) {
  const { t, lang, target, currency } = useI18n();
  const [tab, setTab] = useState<HubTab>(initialTab);
  const [diaryId, setDiaryId] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(initialSkillNodeId);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(initialTab);
    setNodeId(initialSkillNodeId);
  }, [open, initialTab, initialSkillNodeId]);

  // Escape closes the inspector first, then the notebook.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (nodeId) setNodeId(null);
      else if (mode !== "resume") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, nodeId, mode, onClose]);

  const s = run.state;
  const mainCast = story.cast.filter((c) => !c.minor && !c.townsfolk);
  const here: Place = story.places.find((p) => p.id === s.place) ?? story.places[0];

  const visited = useMemo(() => {
    const v = new Set<string>(s.visited ?? []);
    v.add(s.place);
    for (const d of entries) v.add(d.place_id);
    return v;
  }, [s.visited, s.place, entries]);

  const met = useMemo(() => {
    const m = new Set<string>(Object.keys(s.trust ?? {}));
    for (const l of [...backlog, ...run.lines]) if (l.speaker in cast) m.add(l.speaker);
    for (const id of s.on_stage ?? []) m.add(id);
    return m;
  }, [s.trust, s.on_stage, backlog, run.lines, cast]);

  const spoken = useMemo(() => {
    const seen = new Set<number>();
    const out: { line: Line; placeName: string; feedback?: DiaryLineFeedback; pron?: number }[] = [];
    for (const entry of entries) {
      const pron = entry.metrics?.pronunciation;
      for (const raw of entry.lines ?? []) {
        const l = normalizeLine(raw);
        if (l.id > 0 && seen.has(l.id)) continue;
        if (l.id > 0) seen.add(l.id);
        const mine = l.speaker === PLAYER;
        out.push({ line: l, placeName: entry.place_name, feedback: mine ? entry.feedbacks?.find((f) => f.line_id === l.id) : undefined, pron: mine ? pron : undefined });
      }
    }
    for (const l of backlog.length > 0 ? backlog : run.lines) {
      if (l.id > 0 && seen.has(l.id)) continue;
      if (l.id > 0) seen.add(l.id);
      out.push({ line: l, placeName: here.name });
    }
    return out;
  }, [entries, backlog, run.lines, here.name]);

  const candosDone = useMemo(() => new Set(s.candos_done ?? []), [s.candos_done]);
  const skills: Record<string, UnlockedSkill> = s.unlocked_skills ?? {};
  const words = Object.entries(s.known_words ?? {}).filter(([, w]) => w.kind !== "particle");
  const owned = words.filter(([, w]) => w.mastered).length;
  const stars = Object.values(skills).reduce((n, k) => n + Math.min(3, Math.max(1, k.mastery_level || 1)), 0);
  const quest = story.quests.find((q) => q.id === s.quest);
  const activeDiary = entries.find((e) => e.id === diaryId) ?? entries[entries.length - 1] ?? null;
  const shownPlace = story.places.find((p) => p.id === (placeId ?? here.id)) ?? here;
  const inspected = nodeId ? story.lessons.find((l) => lessonNodeId(l.index) === nodeId) ?? null : null;

  const say = (text: string, speakerId?: string) => {
    if (onPreviewVoice) return onPreviewVoice(text, speakerId);
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = target === "en" ? "en-US" : "ja-JP";
    u.rate = 0.9;
    speechSynthesis.speak(u);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={mode === "resume" ? undefined : onClose} />
          <motion.div
            className="fixed inset-2 z-50 mx-auto flex max-w-6xl flex-col overflow-hidden rounded-[26px] bg-cream text-ink shadow-2xl sm:inset-4"
            initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 230, damping: 28 }}
          >
            <header className="border-b border-hairline px-5 pb-3 pt-5 sm:px-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted">{t.hub.kicker}</p>
                  <h2 className="tight mt-0.5 text-3xl font-medium">{t.hub.title(s.player_name)}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {mode === "resume" && (
                    <>
                      <GhostButton onClick={onClose}>{t.backToTitle}</GhostButton>
                      {onEnterScene && <SolidButton onClick={onEnterScene} tone="shu">{t.hub.enterScene}</SolidButton>}
                    </>
                  )}
                  {mode === "scorecard" && (
                    <>
                      <GhostButton onClick={onClose}>{t.hub.backToScore}</GhostButton>
                      {onNextScene && <SolidButton onClick={onNextScene} tone="shu">{t.nextScene}</SolidButton>}
                    </>
                  )}
                  {mode === "ingame" && <SolidButton onClick={onClose}>{t.hub.returnToScene}</SolidButton>}
                </div>
              </div>

              {/* where you are right now */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex -space-x-2">
                    {here.cast.map((id) => cast[id] && (
                      <Avatar key={id} member={cast[id]} size="h-10 w-10" />
                    ))}
                  </div>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="tight text-lg font-medium">{here.name}</span>
                      <span className="font-jp text-sm text-muted">{here.name_jp}</span>
                      <span className="text-xs text-muted">· {here.clock}</span>
                    </p>
                    <p className="tight truncate text-sm text-ink/70">{here.goal}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs tabular-nums">
                  <Chip>{currency}{s.yen.toLocaleString()}</Chip>
                  <Chip>{t.hub.battery(s.battery)}</Chip>
                </div>
              </div>

              <nav className="mt-3 flex gap-1 overflow-x-auto">
                {TABS.map((id) => (
                  <button key={id} onClick={() => setTab(id)}
                    className={`relative shrink-0 rounded-full px-4 py-1.5 text-sm transition ${tab === id ? "text-cream" : "text-ink/65 hover:text-ink"}`}>
                    {tab === id && <motion.span layoutId="hub-tab" className="absolute inset-0 rounded-full bg-ink" />}
                    <span className="relative">{t.hub.tabs[id]}</span>
                  </button>
                ))}
              </nav>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
              {tab === "story" && <FlowChart flow={s.flow ?? []} />}

              {tab === "progress" && (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label={t.hub.lessonsAwake} value={Object.keys(skills).length} of={story.lessons.length} />
                    <Stat label={t.hub.stars} value={stars} of={story.lessons.length * 3} />
                    <Stat label={t.hub.wordsOwned} value={owned} of={words.length} />
                    <Stat label={t.hub.scenesCleared} value={entries.length} of={story.places.length} />
                  </div>

                  {quest && (
                    <div className="rounded-2xl border border-shu/25 bg-shu/[0.04] px-5 py-4">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-shu">{t.hub.quest}</p>
                      <p className="tight mt-1 text-xl font-medium">“{quest.title}”</p>
                      {quest.title_jp && <p className="font-jp text-sm text-muted">{quest.title_jp}</p>}
                    </div>
                  )}

                  <section>
                    <SectionHead title={t.hub.treeTitle} body={t.hub.treeBody} />
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {story.lessons.map((l) => (
                        <LessonNode key={l.index} lesson={l} skill={skills[lessonNodeId(l.index)]}
                          current={l.index === s.lesson_idx} reached={l.index <= s.lesson_idx}
                          done={l.candos.filter((c) => candosDone.has(c.id)).length}
                          onOpen={() => setNodeId(lessonNodeId(l.index))} />
                      ))}
                    </div>
                  </section>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <section className="rounded-2xl bg-white/70 p-5">
                      <SectionHead title={t.hub.scorecards(entries.length)} body={t.hub.scorecardsBody} small />
                      {entries.length === 0 ? (
                        <p className="mt-4 text-sm text-muted">{t.hub.noScorecards}</p>
                      ) : (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {entries.map((e, i) => (
                            <button key={e.id} onClick={() => { setDiaryId(e.id); setTab("diary"); }}
                              className="flex items-center justify-between rounded-xl bg-cream px-3 py-2.5 text-left transition hover:bg-cream-deep">
                              <span>
                                <span className="block text-[13px] font-medium">{i + 1}. {e.place_name}</span>
                                <span className="block text-[11px] text-muted">{t.hub.scoreLine(e.score, e.turns_used)}</span>
                              </span>
                              <RankBadge rank={rankOf(e.rank)} size="h-8 w-8 text-sm" />
                            </button>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="rounded-2xl bg-white/70 p-5">
                      <SectionHead title={t.hub.wordBank(words.length)} body={t.wordsIntro(owned, words.length)} small />
                      {words.length === 0 ? (
                        <p className="mt-4 text-sm text-muted">{t.noWords}</p>
                      ) : (
                        <ul className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                          {words
                            .sort(([, a], [, b]) => Number(b.mastered) - Number(a.mastered) || (b.uses ?? 0) - (a.uses ?? 0))
                            .map(([jp, w]) => (
                              <li key={jp} className={`rounded-xl px-3 py-2 ${w.mastered ? "bg-ink text-cream" : "bg-cream"}`}>
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="font-jp text-base">{jp}</span>
                                  {w.mastered && <span className="text-[10px] uppercase tracking-wider opacity-70">{t.owned}</span>}
                                </div>
                                <p className="text-xs opacity-60">{w.romaji}</p>
                                <p className="text-[13px]">{w.en}</p>
                                {!w.mastered && <UseMeter uses={w.uses ?? 0} />}
                              </li>
                            ))}
                        </ul>
                      )}
                    </section>
                  </div>
                </div>
              )}

              {tab === "people" && (
                <div className="space-y-5">
                  <SectionHead title={t.hub.peopleTitle} body={t.hub.metCount(met.size, mainCast.length)} />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {mainCast.map((c) => {
                      const known = met.has(c.id);
                      const trust = s.trust?.[c.id] ?? 0;
                      return (
                        <div key={c.id} className={`flex gap-4 rounded-2xl p-4 ${known ? "bg-white/80" : "bg-white/35"}`}>
                          <Avatar member={c} size="h-20 w-16" square muted={!known} />
                          <div className="min-w-0 flex-1">
                            <p className="tight text-lg font-medium leading-tight">{known ? c.name : t.hub.someone}</p>
                            {known && <p className="font-jp text-sm text-muted">{c.name_jp}</p>}
                            <p className="tight mt-1 text-[13px] leading-snug text-ink/70">{known ? c.role : t.hub.notMet}</p>
                            {known && (
                              <div className="mt-3">
                                <div className="flex justify-between text-[11px] text-muted">
                                  <span>{t.hub.trust}</span>
                                  <span className="tabular-nums">{trust > 0 ? `+${trust}` : trust}</span>
                                </div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream-deep">
                                  <div className="h-full rounded-full" style={{ width: `${((trust + TRUST_RANGE) / (2 * TRUST_RANGE)) * 100}%`, background: c.color }} />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {tab === "places" && (
                <div className="space-y-5">
                  <SectionHead title={t.hub.placesTitle} body={t.hub.visitedCount(visited.size, story.places.length)} />
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {story.places.map((p) => {
                      const been = visited.has(p.id);
                      const active = shownPlace.id === p.id;
                      return (
                        <button key={p.id} disabled={!been} onClick={() => setPlaceId(p.id)}
                          className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition ${
                            active ? "bg-ink text-cream" : been ? "bg-white/80 hover:bg-white" : "cursor-default bg-white/30 text-muted"
                          }`}>
                          {been ? p.name : "？？？"}
                          {p.id === here.id && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-shu align-middle" />}
                        </button>
                      );
                    })}
                  </div>
                  <PlaceDetail place={shownPlace} here={shownPlace.id === here.id} run={run} cast={cast}
                    canGo={(s.exits ?? []).some((e) => e.to === shownPlace.id && e.open)}
                    onTravel={onTravel} onSay={say} />
                </div>
              )}

              {tab === "diary" && (
                <div className="space-y-6">
                  {run.journal.length > 0 && (
                    <section>
                      <SectionHead title={t.journal} />
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {run.journal.map((j) => (
                          <blockquote key={j.seq} className="rounded-2xl bg-white/70 p-4 text-[15px] italic leading-relaxed text-ink/85">
                            <span className="mb-1 block text-[10px] not-italic uppercase tracking-wider text-muted">{t.entry(j.seq)}</span>
                            “{j.text}”
                          </blockquote>
                        ))}
                      </div>
                    </section>
                  )}

                  {entries.length === 0 ? (
                    <div className="rounded-2xl bg-white/60 px-6 py-10 text-center">
                      <p className="tight text-lg font-medium">{t.hub.noDebriefs}</p>
                      <p className="tight mx-auto mt-1 max-w-md text-sm text-muted">{t.hub.noDebriefsBody}</p>
                    </div>
                  ) : (
                    <section className="space-y-3">
                      <SectionHead title={t.hub.debriefs} />
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {entries.map((e, i) => {
                          const sel = activeDiary?.id === e.id;
                          return (
                            <button key={e.id} onClick={() => setDiaryId(e.id)}
                              className={`flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-left transition ${sel ? "bg-ink text-cream" : "bg-white/80 hover:bg-white"}`}>
                              <RankBadge rank={rankOf(e.rank)} size="h-6 w-6 text-xs" />
                              <span className="text-xs leading-tight">
                                <span className="block font-medium">{i + 1}. {e.place_name}</span>
                                <span className={sel ? "text-cream/65" : "text-muted"}>{e.score}/100</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {activeDiary && (
                        <div className="rounded-2xl bg-white/80 p-5">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <p className="flex items-baseline gap-2">
                                <span className="tight text-2xl font-medium">{activeDiary.place_name}</span>
                                <span className="font-jp text-muted">{activeDiary.place_name_jp}</span>
                              </p>
                              <p className="mt-0.5 text-xs text-muted">
                                {[formatDate(activeDiary.created_at, lang), t.turnsSpoken(activeDiary.turns_used, activeDiary.voice_turns),
                                  t.levels[activeDiary.difficulty as keyof typeof t.levels]?.label].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-right">
                                <span className="block text-[11px] uppercase tracking-wider text-muted">{t.totalScore}</span>
                                <span className="text-xl font-semibold tabular-nums">{activeDiary.score} / 100</span>
                              </span>
                              <RankBadge rank={rankOf(activeDiary.rank)} size="h-12 w-12 text-2xl" />
                            </div>
                          </div>
                          {Object.keys(activeDiary.metrics ?? {}).length > 0 && (
                            <div className="mt-4 space-y-2.5 border-t border-hairline pt-4">
                              {Object.entries(activeDiary.metrics).map(([k, v]) => (
                                <div key={k}>
                                  <div className="flex justify-between text-xs">
                                    <span className="text-ink/75">{metricLabel(t, k)}</span>
                                    <span className="tabular-nums">{v}%</span>
                                  </div>
                                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream-deep">
                                    <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {activeDiary.journal && (
                            <p className="tight mt-4 border-t border-hairline pt-3 text-[15px] italic text-ink/80">“{activeDiary.journal}”</p>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}

              {tab === "log" && (
                <div className="space-y-4">
                  <SectionHead title={t.hub.logTitle} body={t.hub.logCount(spoken.length)} />
                  {spoken.length === 0 ? (
                    <p className="text-sm text-muted">{t.hub.noLog}</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {spoken.map(({ line: l, placeName, feedback: fb, pron }, i) => {
                        if (l.speaker === NARRATOR) {
                          return <li key={`${l.id}-${i}`} className="px-1 text-sm italic text-ink/55">{l.en}</li>;
                        }
                        const mine = l.speaker === PLAYER;
                        const who = mine ? s.player_name : cast[l.speaker]?.name ?? l.speaker_name ?? l.speaker;
                        return (
                          <li key={`${l.id}-${i}`} className={`rounded-2xl px-4 py-3 ${mine ? "bg-shu/[0.05] ring-1 ring-shu/20" : "bg-white/75"}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs">
                                <span className="font-semibold uppercase tracking-wider" style={{ color: mine ? "#c8202f" : cast[l.speaker]?.color ?? "#555" }}>{who}</span>
                                <span className="text-muted"> · {placeName}</span>
                              </span>
                              <span className="flex items-center gap-1.5">
                                {mine && pron !== undefined && <Chip>{t.hub.pronunciation(pron)}</Chip>}
                                {fb && fb.verdict !== "none" && <Chip>{(t.verdict as Record<string, string>)[fb.verdict] ?? fb.verdict}</Chip>}
                                {!mine && l.jp && onReplayLine && (
                                  <button onClick={() => onReplayLine(l)} className="rounded-full bg-cream-deep px-3 py-1 text-xs transition hover:bg-ink hover:text-cream">
                                    {t.again}
                                  </button>
                                )}
                              </span>
                            </div>
                            {l.jp && <p className="mt-1 font-jp text-lg">{l.jp}</p>}
                            {l.romaji && <p className="text-xs text-shu">{l.romaji}</p>}
                            {l.en && <p className="tight text-sm text-ink/70">“{l.en}”</p>}
                            {fb && (fb.note || fb.better_jp) && (
                              <div className="mt-2.5 rounded-xl bg-white px-3.5 py-2.5 text-sm">
                                <p className="text-[10px] uppercase tracking-wider text-muted">{t.senseiNote}</p>
                                {fb.note && <p className="tight mt-0.5 text-ink/85">{fb.note}</p>}
                                {fb.better_jp && (
                                  <div className="mt-2 border-t border-hairline pt-2">
                                    <p className="text-[10px] uppercase tracking-wider text-muted">{t.moreNatural}</p>
                                    <p className="font-jp">{fb.better_jp}</p>
                                    {fb.better_romaji && <p className="text-xs text-shu">{fb.better_romaji}</p>}
                                    {fb.better_en && <p className="text-xs text-ink/65">“{fb.better_en}”</p>}
                                  </div>
                                )}
                                {(fb.grammar_used?.length ?? 0) > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {fb.grammar_used!.map((g) => (
                                      <span key={g} className="rounded-md bg-cream-deep px-2 py-0.5 font-jp text-[11px]">✓ {grammar[g]?.pattern ?? g}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <AnimatePresence>
              {inspected && (
                <LessonInspector lesson={inspected} skill={skills[lessonNodeId(inspected.index)]} candosDone={candosDone}
                  reached={inspected.index <= s.lesson_idx} speaker={here.cast[0]} onSay={say} onClose={() => setNodeId(null)} />
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function LessonNode({ lesson, skill, current, reached, done, onOpen }: {
  lesson: Lesson; skill?: UnlockedSkill; current: boolean; reached: boolean; done: number; onOpen: () => void;
}) {
  const { t } = useI18n();
  const level = skill ? Math.min(3, Math.max(1, skill.mastery_level || 1)) : 0;
  const total = lesson.candos.length;
  return (
    <button onClick={onOpen}
      className={`group flex flex-col rounded-2xl p-4 text-left transition ${
        current ? "bg-white ring-1 ring-ink/80" : reached || skill ? "bg-white/75 hover:bg-white" : "bg-white/35 hover:bg-white/60"
      }`}>
      <span className="flex items-center justify-between text-[11px] text-muted">
        <span className="uppercase tracking-wider">
          {t.lesson} {lesson.index}
          {current && <span className="ml-1.5 rounded-full bg-shu px-1.5 py-px text-[10px] normal-case tracking-normal text-white">{t.now}</span>}
        </span>
        <Stars n={level} />
      </span>
      <span className={`tight mt-1.5 text-[17px] font-medium leading-snug ${reached || skill ? "" : "text-ink/50"}`}>{lesson.title}</span>
      <span className="font-jp text-[13px] text-muted">{lesson.title_jp}</span>
      {total > 0 && (
        <span className="mt-3 flex items-center gap-2">
          <span className="flex flex-1 gap-1">
            {lesson.candos.map((c, i) => (
              <span key={c.id} className={`h-1 flex-1 rounded-full ${i < done ? "bg-shu" : "bg-ink/10"}`} />
            ))}
          </span>
          <span className="text-[11px] tabular-nums text-muted">{done}/{total}</span>
        </span>
      )}
    </button>
  );
}

function LessonInspector({ lesson, skill, candosDone, reached, speaker, onSay, onClose }: {
  lesson: Lesson; skill?: UnlockedSkill; candosDone: Set<string>; reached: boolean; speaker?: string;
  onSay: (text: string, speakerId?: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <motion.div className="absolute inset-0 z-10 flex items-center justify-center bg-ink/35 p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-[22px] bg-cream p-6 shadow-2xl sm:p-7"
        initial={{ y: 16, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 10, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted">{t.lesson} {lesson.index}</p>
            <h3 className="tight mt-0.5 text-3xl font-medium">{lesson.title}</h3>
            <p className="font-jp text-muted">{lesson.title_jp}</p>
            <p className="tight mt-2 text-[15px] text-ink/75">{lesson.topic}</p>
          </div>
          <button onClick={onClose} aria-label={t.close} className="rounded-full px-2 text-2xl text-muted hover:text-ink">×</button>
        </div>

        {skill ? (
          <div className="mt-5 rounded-2xl bg-ink px-5 py-4 text-cream">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-cream/60">
              <span>{t.hub.yourLine}</span>
              <Stars n={Math.min(3, Math.max(1, skill.mastery_level || 1))} light />
            </div>
            <p className="mt-1 font-jp text-xl">{skill.sentence}</p>
            <p className="mt-1 text-xs text-cream/60">
              {[skill.place_name, skill.pron_score != null ? t.hub.pronunciation(skill.pron_score) : null, t.hub.uses(skill.uses)].filter(Boolean).join(" · ")}
            </p>
          </div>
        ) : (
          <p className="tight mt-5 rounded-2xl bg-white/70 px-5 py-4 text-sm text-muted">{reached ? t.hub.sayToAwaken : t.hub.aheadOfYou}</p>
        )}

        {lesson.candos.length > 0 && (
          <section className="mt-6">
            <p className="text-sm font-medium">{t.iCan}</p>
            <ul className="mt-2 space-y-2">
              {lesson.candos.map((c) => {
                const done = candosDone.has(c.id);
                return (
                  <li key={c.id} className="flex items-start justify-between gap-3 rounded-xl bg-white/70 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className={`tight block text-[15px] ${done ? "" : "text-ink/75"}`}>
                        <span className={done ? "text-shu" : "text-ink/30"}>{done ? "✓" : "○"}</span> {c.text}
                      </span>
                      <span className="font-jp text-sm">{c.example}</span>
                      <span className="block text-xs text-muted">{c.example_reading}</span>
                    </span>
                    <button onClick={() => onSay(c.example, speaker)} className="shrink-0 rounded-full border border-hairline px-3 py-1 text-xs transition hover:bg-cream-deep">
                      {t.listen}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="mt-6">
          <p className="text-sm font-medium">{t.hub.grammar}</p>
          <ul className="mt-2 space-y-1.5">
            {lesson.grammar.map((g) => (
              <li key={g.id} className="rounded-xl bg-white/70 px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-jp font-medium">{g.pattern}</span>
                  <span className="tight text-sm text-muted">{g.meaning}</span>
                </div>
                <p className="mt-0.5 font-jp text-sm">{g.example_jp} <span className="text-ink/45">— {g.example_en}</span></p>
              </li>
            ))}
          </ul>
        </section>
      </motion.div>
    </motion.div>
  );
}

function PlaceDetail({ place, here, run, cast, canGo, onTravel, onSay }: {
  place: Place; here: boolean; run: Run; cast: Record<string, CastMember>; canGo: boolean;
  onTravel?: (to: string) => void; onSay: (text: string) => void;
}) {
  const { t } = useI18n();
  const known = run.state.known_words ?? {};
  const seen = new Set(run.state.seen_words ?? []);
  // Key words stay a mystery until met: looked up words show meanings, met ones just the word.
  const looked = place.pack.filter((w) => w.jp in known);
  const met = place.pack.filter((w) => !(w.jp in known) && seen.has(w.jp));
  const hidden = place.pack.length - looked.length - met.length;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-2xl bg-white/80 p-5">
        <p className="flex items-center gap-2 text-xs text-muted">
          {place.clock}
          {here && <span className="rounded-full bg-shu px-2 py-px text-[10px] text-white">{t.youAreHere}</span>}
        </p>
        <h3 className="tight mt-1 text-3xl font-medium">{place.name}</h3>
        <p className="font-jp text-muted">{place.name_jp}</p>
        <div className="mt-4 rounded-xl bg-cream px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-muted">{t.objective}</p>
          <p className="tight mt-0.5 text-[15px]">{place.goal}</p>
        </div>
        {place.cast.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {place.cast.map((id) => cast[id] && (
              <span key={id} className="flex items-center gap-2 rounded-full bg-cream py-1 pl-1 pr-3 text-sm">
                <Avatar member={cast[id]} size="h-7 w-7" />
                {cast[id].name}
              </span>
            ))}
          </div>
        )}
        {canGo && onTravel && (
          <button onClick={() => onTravel(place.id)} className="mt-5 rounded-full bg-ink px-5 py-2 text-sm text-cream transition hover:bg-ink/85">
            {t.go} → {place.name}
          </button>
        )}
      </div>
      <div className="rounded-2xl bg-white/80 p-5">
        <div className="flex items-baseline justify-between">
          <p className="tight text-lg font-medium">{t.hub.keyWords}</p>
          <span className="text-xs text-muted">{place.pack.length}</span>
        </div>
        <ul className="mt-3 space-y-1.5">
          {looked.map((w) => (
            <li key={w.jp} className="flex items-center justify-between gap-2 rounded-xl bg-cream px-3 py-2">
              <span>
                <span className="font-jp">{w.jp}</span>
                <span className="block text-xs text-muted">{w.romaji} · {known[w.jp]?.en ?? w.en}</span>
              </span>
              <button onClick={() => onSay(w.jp)} className="text-xs text-muted hover:text-ink">{t.listen}</button>
            </li>
          ))}
          {met.map((w) => (
            <li key={w.jp} className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-ink/20 px-3 py-2">
              <span className="font-jp">{w.jp}</span>
              <span className="text-[11px] text-muted">{t.hub.lookItUp}</span>
            </li>
          ))}
        </ul>
        {hidden > 0 && <p className="mt-3 text-xs text-muted">{t.hub.wordsToFind(hidden)}</p>}
      </div>
    </div>
  );
}

function Avatar({ member, size, square, muted }: { member: CastMember; size: string; square?: boolean; muted?: boolean }) {
  return (
    <span className={`block shrink-0 overflow-hidden border-2 border-white bg-cream-deep ${square ? "rounded-xl" : "rounded-full"} ${size}`}
      style={{ boxShadow: `inset 0 -3px 0 ${member.color}55` }} title={member.name}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={member.sprite} alt="" className={`h-full w-full object-cover object-top ${muted ? "opacity-40 grayscale" : ""}`} />
    </span>
  );
}

function Stars({ n, light }: { n: number; light?: boolean }) {
  return (
    <span className="flex gap-0.5" aria-label={`${n}/3`}>
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 12 12" className={`h-3 w-3 ${i < n ? (light ? "text-cream" : "text-shu") : light ? "text-cream/25" : "text-ink/15"}`} fill="currentColor">
          <path d="M6 .8l1.6 3.3 3.6.5-2.6 2.5.6 3.6L6 9l-3.2 1.7.6-3.6L.8 4.6l3.6-.5z" />
        </svg>
      ))}
    </span>
  );
}

function UseMeter({ uses }: { uses: number }) {
  return (
    <span className="mt-1 flex gap-0.5">
      {Array.from({ length: OWN_AFTER }, (_, k) => (
        <span key={k} className={`h-1 w-3 rounded-full ${uses > k ? "bg-shu" : "bg-ink/15"}`} />
      ))}
    </span>
  );
}

function RankBadge({ rank, size }: { rank: Rank; size: string }) {
  const st = RANK_STYLES[rank];
  return <span className={`grid shrink-0 place-items-center rounded-full font-semibold ${st.bg} ${st.text} ${size}`}>{rank}</span>;
}

function Stat({ label, value, of }: { label: string; value: number; of: number }) {
  return (
    <div className="rounded-2xl bg-white/75 px-4 py-3.5">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 tabular-nums">
        <span className="tight text-3xl font-medium">{value}</span>
        <span className="text-sm text-muted"> / {of}</span>
      </p>
    </div>
  );
}

function SectionHead({ title, body, small }: { title: string; body?: string; small?: boolean }) {
  return (
    <div>
      <h3 className={`tight font-medium ${small ? "text-lg" : "text-xl"}`}>{title}</h3>
      {body && <p className="tight text-sm text-muted">{body}</p>}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-cream-deep px-2.5 py-1 text-[11px] text-ink/80">{children}</span>;
}

function SolidButton({ children, onClick, tone = "ink" }: { children: React.ReactNode; onClick: () => void; tone?: "ink" | "shu" }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-5 py-2 text-sm font-medium text-cream transition ${tone === "shu" ? "bg-shu hover:bg-shu/90" : "bg-ink hover:bg-ink/85"}`}>
      {children}
    </button>
  );
}

function GhostButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full px-4 py-2 text-sm text-ink/70 transition hover:bg-cream-deep hover:text-ink">
      {children}
    </button>
  );
}

const BRANCH_STYLE: Record<FlowBranch["status"], string> = {
  taken: "bg-ink text-cream",
  open: "border border-ink/30 bg-white/80 text-ink",
  closed: "bg-ink/5 text-muted line-through decoration-ink/25",
  locked: "border border-dashed border-ink/15 text-muted/70",
};

/** The story graph as lived, Detroit-style: objectives, their steps, and the ways through. */
function FlowChart({ flow }: { flow: FlowQuest[] }) {
  const { t } = useI18n();
  const f = t.hub.flow;
  return (
    <div className="space-y-6">
      <SectionHead title={f.title} body={f.body} />
      <ol className="relative space-y-5 border-l-2 border-ink/10 pl-6">
        {flow.map((q, qi) => (
          <li key={qi} className="relative">
            <span className={`absolute -left-[33px] top-1 h-4 w-4 rounded-full border-2 ${
              q.status === "done" ? "border-ink bg-ink" : q.status === "active" ? "border-shu bg-cream" : "border-ink/20 bg-cream"
            }`} />
            <p className={`tight text-lg font-semibold ${q.status === "locked" ? "text-muted" : ""}`}>
              {q.status === "locked" ? `？？？ · ${f.locked_quest}` : q.title}
            </p>
            {q.steps.length > 0 && (
              <div className="mt-2 space-y-2.5">
                {q.steps.map((st, si) => (
                  <div key={si} className="rounded-2xl bg-white/60 px-4 py-3">
                    <p className={`tight text-[15px] font-medium ${st.status === "done" ? "" : "text-ink/80"}`}>
                      {st.status === "done" ? "✓ " : "○ "}{st.title}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {st.branches.map((b, bi) => (
                        <span key={bi} title={f[b.status]} className={`rounded-full px-2.5 py-1 text-[12px] ${BRANCH_STYLE[b.status]}`}>
                          {b.label}
                          {b.at && <span className="opacity-60"> · {b.at}</span>}
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide opacity-60">{f[b.status]}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
