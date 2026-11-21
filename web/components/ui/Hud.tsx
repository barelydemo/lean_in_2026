"use client";

import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import type { CastMember, Item, Lesson, Place, Quest, RunState } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import type { HubTab } from "./CompanionHub";
import { ClockIcon, Mark, NotchTab, PinIcon } from "./Frame";

const OPEN_KEY = "lexical.hud.open";

interface Props {
  /** The on-screen scene's own clock (the dorm at dawn), else the place's. */
  clock?: string;
  cast: Record<string, CastMember>;
  place: Place;
  lesson: Lesson;
  quest: Quest | undefined;
  state: RunState;
  items: Record<string, Item>;
  diaryCount?: number;
  onMap: () => void;
  onOpenHub?: (tab: HubTab) => void;
  onDiary: () => void;
  onNotebook: () => void;
  onSettings: () => void;
}

function Money({ value, currency }: { value: number; currency: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => `${currency}${Math.round(v).toLocaleString()}`);
  useEffect(() => {
    const c = animate(mv, value, { duration: 1.2, ease: "easeOut" });
    return c.stop;
  }, [value, mv]);
  return <motion.span>{text}</motion.span>;
}

export function Hud({ cast, place, clock, lesson, quest, state, items, diaryCount = 0, onMap, onOpenHub, onDiary, onNotebook, onSettings }: Props) {
  const { t, currency } = useI18n();
  const shown = new Set(state.lesson_grammar);
  const done = new Set(state.candos_done ?? []);
  const candosDone = lesson.candos.filter((c) => done.has(c.id)).length;
  const [allGoals, setAllGoals] = useState(false);
  // Collapsed keeps only the objective and lead; remembered per browser.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleOpen = () => {
    setOpen((o) => {
      try { localStorage.setItem(OPEN_KEY, o ? "0" : "1"); } catch {}
      return !o;
    });
  };
  const openExitsList = (state.exits ?? []).filter((e) => e.open);
  const openExits = openExitsList.length;
  const primaryExit = openExitsList[0];
  const openTab = (tab: HubTab, fallback: () => void) => (onOpenHub ? onOpenHub(tab) : fallback());
  return (
    <>
      <NotchTab corner="tl">
        <Mark small />
        <span className="hidden h-4 w-px bg-hairline sm:block" />
        <span className="hidden items-baseline gap-1.5 sm:flex">
          <span className="font-jp text-[15px] font-medium">{place.name_jp}</span>
          <span className="tight text-[15px]">{place.name}</span>
        </span>
      </NotchTab>

      <NotchTab corner="tr">
        <span className="flex items-center gap-1.5 text-[15px] tabular-nums">
          <span className="h-2 w-2 rounded-full bg-sky" />
          <Money value={state.yen} currency={currency} />
        </span>
        {state.items.length > 0 && (
          <span className="flex gap-0.5">
            {state.items.map((id) => (
              <motion.span key={id} title={items[id]?.name} className="text-lg"
                initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring" }}>
                {items[id]?.icon ?? "•"}
              </motion.span>
            ))}
          </span>
        )}
        <span className="h-4 w-px bg-hairline" />
        <TabButton label={`${t.map} (M)`} onClick={onMap}>
          {t.map}{openExits > 0 && <span className="ml-1 rounded-full bg-shu px-1.5 text-[11px] text-white">{openExits}</span>}
        </TabButton>
        <TabButton label={t.notebook} onClick={() => openTab("progress", onNotebook)}>{t.notebook}</TabButton>
        <TabButton label={t.diary} onClick={() => openTab("diary", onDiary)}>
          {t.diary}{diaryCount > 0 && <span className="ml-1 rounded-full bg-ink/10 px-1.5 text-[11px] text-ink">{diaryCount}</span>}
        </TabButton>
        <TabButton label={t.settings} onClick={onSettings}>
          <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <circle cx="10" cy="10" r="2.6" />
            <path d="M10 1.8v2.4M10 15.8v2.4M18.2 10h-2.4M4.2 10H1.8M15.8 4.2l-1.7 1.7M5.9 14.1l-1.7 1.7M15.8 15.8l-1.7-1.7M5.9 5.9 4.2 4.2" strokeLinecap="round" />
          </svg>
        </TabButton>
      </NotchTab>

      {/* the player's own thoughts: what I'm here to do, what to try next, then what helps */}
      <motion.div
        className="frost pointer-events-auto absolute left-4 top-16 z-10 w-[min(25rem,calc(100%-2rem))] rounded-2xl px-4 py-3 sm:left-6 sm:top-[4.5rem]"
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${state.goal_done && !state.objective ? "bg-ink/30" : "bg-shu"}`} />
            {state.goal_done && !state.objective ? t.objectiveDone : t.objective}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            {quest && <span className="tight truncate text-[12px] italic text-muted">“{quest.title}”</span>}
            <button onClick={toggleOpen} aria-label={open ? t.hideDetails : t.showDetails} title={open ? t.hideDetails : t.showDetails}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted transition hover:bg-ink/5 hover:text-ink">
              <svg viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} fill="none" stroke="currentColor" strokeWidth={1.6}>
                <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </span>
        </div>
        {/* The story graph's current step, and the ways open: here first. */}
        {state.objective ? (
          <>
            <p className="tight mt-1 text-[16px] font-medium leading-snug text-ink">{state.objective.step}</p>
            {state.objective.progress && <p className="mt-0.5 text-[13px] font-medium text-shu">{state.objective.progress}</p>}
            {state.objective.why && <p className="tight mt-0.5 text-[13px] leading-snug text-ink/65">{state.objective.why}</p>}
            {(state.objective.here.length > 0 || state.objective.elsewhere.length > 0) && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {state.objective.here.map((w) => (
                  <span key={w} className="rounded-full bg-shu px-2.5 py-0.5 text-[12px] font-medium text-white">
                    {t.waysHere} · {w}
                  </span>
                ))}
                {state.objective.elsewhere.map(([w, at]) => (
                  <span key={w + at} className="rounded-full border border-ink/15 bg-white/70 px-2.5 py-0.5 text-[12px] text-ink/80">
                    {w} <span className="text-muted">· {at}</span>
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className={`tight mt-1 text-[16px] font-medium leading-snug ${state.goal_done ? "text-muted line-through decoration-shu/60" : "text-ink"}`}>
            {place.goal}
          </p>
        )}
        <AnimatePresence mode="wait">
          {state.lead && (
            <motion.p key={state.lead} className="tight mt-1.5 flex gap-1.5 text-[13px] italic leading-snug text-ink/70"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <span aria-hidden className="not-italic text-shu">→</span>
              {state.lead}
            </motion.p>
          )}
        </AnimatePresence>
        {state.goal_done && primaryExit && (
          <button onClick={onMap}
            className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl bg-ink px-3 py-1.5 text-left text-[13px] text-cream transition hover:bg-ink/85">
            <span className="truncate">{t.nextUp}: {primaryExit.label}</span>
            <span aria-hidden>→</span>
          </button>
        )}

        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden">
              <KeyWords place={place} state={state} />
              <Pressure state={state} cast={cast} />
              <div className="mt-2.5 border-t border-hairline pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-muted">{t.lesson} {lesson.index} · {lesson.title}</span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {lesson.candos.length > 0
                      ? candosDone >= lesson.candos.length ? t.lessonGrammarDone : t.canDoProgress(candosDone, lesson.candos.length)
                      : state.lesson_grammar.length >= lesson.min_grammar ? t.lessonGrammarDone : t.toPass(state.lesson_grammar.length, lesson.min_grammar)}
                  </span>
                </div>
                {lesson.candos.length > 0 && (
                  <div className="mt-1.5 flex gap-1">
                    {lesson.candos.map((c) => <span key={c.id} className={`h-1 flex-1 rounded-full ${done.has(c.id) ? "bg-shu" : "bg-ink/10"}`} />)}
                  </div>
                )}
                {lesson.candos.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {(allGoals ? lesson.candos : lesson.candos.filter((c) => !done.has(c.id)).slice(0, 2)).map((c) => (
                      <motion.li key={c.id} title={`${c.example} — ${c.example_reading}`}
                        className={`flex items-start gap-1.5 text-[13px] leading-snug ${done.has(c.id) ? "text-muted" : "text-ink"}`}
                        animate={done.has(c.id) ? { scale: [1, 1.04, 1] } : {}}>
                        <span className={`mt-[3px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[9px] ${done.has(c.id) ? "bg-shu text-white" : "border border-hairline"}`}>
                          {done.has(c.id) ? "✓" : ""}
                        </span>
                        <span className={done.has(c.id) ? "line-through decoration-shu/50" : ""}>{c.text}</span>
                      </motion.li>
                    ))}
                    {lesson.candos.length > 2 && (
                      <li>
                        <button onClick={() => setAllGoals((v) => !v)} className="text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink">
                          {allGoals ? t.showLess : t.showAll}
                        </button>
                      </li>
                    )}
                  </ul>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {lesson.grammar.map((g) => (
                      <motion.span
                        key={g.id}
                        title={`${g.example_jp} — ${g.example_en}`}
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          shown.has(g.id) ? "border-shu bg-shu text-white" : "border-hairline bg-white/60 text-ink/70"
                        }`}
                        animate={shown.has(g.id) ? { scale: [1, 1.2, 1] } : {}}
                      >
                        {shown.has(g.id) ? "✓ " : ""}{g.meaning.split(/[—:(]/)[0].trim()}
                        <span className="ml-1 font-jp opacity-60">{g.pattern}</span>
                      </motion.span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* clock + location, bottom-right like a camera overlay */}
      <div className="pointer-events-none absolute bottom-4 right-5 z-10 hidden items-center gap-4 text-[15px] text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)] md:flex">
        <span className="flex items-center gap-1.5"><ClockIcon />1998 · {clock || place.clock}</span>
        <span className="flex items-center gap-1.5"><PinIcon />{place.name}</span>
      </div>
    </>
  );
}

/**
 * This place's key words: looked-up ones with their meaning, heard ones
 * outlined, the rest just counted, so the player knows what to listen for.
 */
function KeyWords({ place, state }: { place: Place; state: RunState }) {
  const { t } = useI18n();
  const known = state.known_words ?? {};
  const seen = new Set(state.seen_words ?? []);
  if (place.pack.length === 0) return null;
  const looked = place.pack.filter((w) => w.jp in known);
  const heard = place.pack.filter((w) => !(w.jp in known) && seen.has(w.jp));
  const hidden = place.pack.length - looked.length - heard.length;
  return (
    <div className="mt-2.5 border-t border-hairline pt-2">
      <p className="text-[11px] font-medium text-muted">{t.wordsToCatch}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {looked.map((w) => (
          <span key={w.jp} className="rounded-full bg-ink px-2 py-0.5 text-[12px] text-cream">
            <span className="font-jp">{w.jp}</span> <span className="text-cream/60">{(known[w.jp]?.en ?? w.en).split(/[/;,]/)[0]}</span>
          </span>
        ))}
        {heard.map((w) => (
          <span key={w.jp} className="rounded-full border border-dashed border-ink/30 px-2 py-0.5 font-jp text-[12px] text-ink/80">{w.jp}</span>
        ))}
        {hidden > 0 && <span className="px-1 py-0.5 text-[12px] text-muted">{t.moreToHear(hidden)}</span>}
      </div>
    </div>
  );
}

/** How long people here will wait, and anything in the scene that won't. */
function Pressure({ state, cast }: { state: RunState; cast: Record<string, CastMember> }) {
  const { t } = useI18n();
  const people = Object.entries(state.patience ?? {}).filter(([id]) => cast[id]);
  const timer = state.timer;
  if (people.length === 0 && !timer) return null;
  return (
    <div className="mt-2.5 space-y-1.5 border-t border-hairline pt-2">
      {timer && timer.left > 0 && (
        <Meter label={timer.label} note={t.inTurns(timer.left)} value={timer.left / timer.total} urgent={timer.left <= 2} />
      )}
      {people.map(([id, left]) => {
        const c = cast[id];
        const name = c.name.split(" ").slice(-1)[0];
        return left > 0 ? (
          <Meter key={id} label={name} note={left <= 2 ? t.impatient : ""} value={left / Math.max(1, c.patience)} urgent={left <= 2} color={c.color} />
        ) : (
          <p key={id} className="flex items-center justify-between text-[12px] text-muted">
            <span className="line-through">{name}</span>
            <span>{t.hasLeft}</span>
          </p>
        );
      })}
    </div>
  );
}

function Meter({ label, note, value, urgent, color }: { label: string; note: string; value: number; urgent: boolean; color?: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="tight w-24 shrink-0 truncate text-ink/80">{label}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
        <motion.span className="block h-full rounded-full" style={{ background: urgent ? "#c8202f" : color ?? "#1c1d20" }}
          initial={false} animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} transition={{ duration: 0.6 }} />
      </span>
      {note && <span className={`shrink-0 ${urgent ? "text-shu" : "text-muted"}`}>{note}</span>}
    </div>
  );
}

function TabButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick}
      className="flex items-center rounded-full px-1.5 py-0.5 text-[15px] text-ink transition hover:text-shu">
      {children}
    </button>
  );
}
