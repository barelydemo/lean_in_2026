"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import type { Item, Lesson, Place, Quest, RunState } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import type { HubTab } from "./CompanionHub";
import { ClockIcon, Mark, NotchTab, PinIcon } from "./Frame";

interface Props {
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

export function Hud({ place, lesson, quest, state, items, diaryCount = 0, onMap, onOpenHub, onDiary, onNotebook, onSettings }: Props) {
  const { t, currency } = useI18n();
  const shown = new Set(state.lesson_grammar);
  const done = new Set(state.candos_done ?? []);
  const candosDone = lesson.candos.filter((c) => done.has(c.id)).length;
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
        <TabButton label="People 👥" onClick={() => openTab("people", onNotebook)}>
          <span className="mr-1 text-sm">👥</span><span className="hidden md:inline">People</span>
        </TabButton>
        <TabButton label="Places 🗺️" onClick={() => openTab("places", onNotebook)}>
          <span className="mr-1 text-sm">🗺️</span><span className="hidden md:inline">Places</span>
        </TabButton>
        <TabButton label="Progress 📈" onClick={() => openTab("progress", onNotebook)}>
          <span className="mr-1 text-sm">📈</span><span className="hidden md:inline">Progress</span>
        </TabButton>
        <TabButton label="Diary 📖" onClick={() => openTab("diary", onDiary)}>
          <span className="mr-1 text-sm">📖</span><span className="hidden sm:inline">Diary</span>{diaryCount > 0 && <span className="ml-1 rounded-full bg-ink/10 px-1.5 text-[11px] text-ink">{diaryCount}</span>}
        </TabButton>
        <TabButton label="Spoken Log 💬" onClick={() => openTab("log", onNotebook)}>
          <span className="mr-1 text-sm">💬</span><span className="hidden md:inline">Log</span>
        </TabButton>
        <TabButton label={t.settings} onClick={onSettings}>
          <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <circle cx="10" cy="10" r="2.6" />
            <path d="M10 1.8v2.4M10 15.8v2.4M18.2 10h-2.4M4.2 10H1.8M15.8 4.2l-1.7 1.7M5.9 14.1l-1.7 1.7M15.8 15.8l-1.7-1.7M5.9 5.9 4.2 4.2" strokeLinecap="round" />
          </svg>
        </TabButton>
      </NotchTab>

      {/* the player's own thoughts: big goal, then what to do here */}
      <motion.div
        className="frost pointer-events-auto absolute left-4 top-16 z-10 w-[min(25rem,calc(100%-2rem))] rounded-2xl px-4 py-3 sm:left-6 sm:top-[4.5rem]"
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            state.goal_done ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
          }`}>
            {state.goal_done ? "✓ Scene Objective Met" : "🎯 Scene Objective"}
          </span>
          {quest && (
            <span className="truncate text-[11px] italic text-muted">“{quest.title}”</span>
          )}
        </div>
        <p className={`tight mt-1.5 text-[14px] font-medium leading-snug ${state.goal_done ? "text-muted line-through decoration-shu/60" : "text-ink"}`}>
          {place.goal}
        </p>
        {state.goal_done && primaryExit && (
          <button
            onClick={onMap}
            className="mt-2 flex w-full items-center justify-between rounded-xl bg-shu/10 px-3 py-1.5 text-left text-[12px] font-semibold text-shu transition hover:bg-shu/20"
          >
            <span>🚪 Next: {primaryExit.label}</span>
            <span className="rounded-full bg-shu px-2 py-0.5 text-[10px] text-white">Go →</span>
          </button>
        )}
        <div className="mt-2.5 border-t border-hairline pt-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted">{t.lesson} {lesson.index} · {lesson.title}</span>
            <span className="text-[11px] text-muted">
              {lesson.candos.length > 0
                ? candosDone >= lesson.candos.length ? t.lessonGrammarDone : t.canDoProgress(candosDone, lesson.candos.length)
                : state.lesson_grammar.length >= lesson.min_grammar ? t.lessonGrammarDone : t.toPass(state.lesson_grammar.length, lesson.min_grammar)}
            </span>
          </div>
          {lesson.candos.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {lesson.candos.map((c) => (
                <motion.li key={c.id} title={`${c.example} — ${c.example_reading}`}
                  className={`flex items-start gap-1.5 text-[13px] leading-snug ${done.has(c.id) ? "text-muted" : "text-ink"}`}
                  animate={done.has(c.id) ? { scale: [1, 1.04, 1] } : {}}>
                  <span className={`mt-[3px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[9px] ${done.has(c.id) ? "bg-shu text-white" : "border border-hairline"}`}>
                    {done.has(c.id) ? "✓" : ""}
                  </span>
                  <span className={done.has(c.id) ? "line-through decoration-shu/50" : ""}>{c.text}</span>
                </motion.li>
              ))}
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

      {/* clock + location, bottom-right like a camera overlay */}
      <div className="pointer-events-none absolute bottom-4 right-5 z-10 hidden items-center gap-4 text-[15px] text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)] md:flex">
        <span className="flex items-center gap-1.5"><ClockIcon />1998 · {place.clock}</span>
        <span className="flex items-center gap-1.5"><PinIcon />{place.name}</span>
      </div>
    </>
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
