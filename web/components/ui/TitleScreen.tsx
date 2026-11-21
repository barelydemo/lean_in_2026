"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Course, Story } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { audio } from "@/lib/audio/engine";
import { Ambient } from "../stage/Ambient";
import { Backdrop } from "../stage/Backdrop";
import { ClockIcon, Mark, NotchTab, PillButton, PinIcon, Waveform } from "./Frame";
import type { Difficulty } from "./Settings";

// ── difficulty metadata ──────────────────────────────────────────────────────

const DIFFICULTIES: {
  id: Difficulty;
  emoji: string;
  label: string;
  tagline: string;
  description: string;
  expects: string[];
  color: string;
  border: string;
}[] = [
  {
    id: "beginner",
    emoji: "🟢",
    label: "Beginner",
    tagline: "I've never spoken Japanese",
    description:
      "You can read a few words from anime or know basic greetings — but when someone speaks, you freeze. That's exactly where Lexical starts.",
    expects: [
      "3 reply options always visible with English meanings",
      "Hear the native pronunciation before you speak",
      "Shadow (repeat) the line out loud to move the story",
    ],
    color: "from-emerald-500/20 to-emerald-500/5",
    border: "border-emerald-500/30",
  },
  {
    id: "intermediate",
    emoji: "🟡",
    label: "Intermediate",
    tagline: "I know words but can't speak freely",
    description:
      "You've studied vocabulary and grammar — maybe finished Duolingo or a textbook — but real conversations still make you panic. Time to fix that.",
    expects: [
      "3 options shown — meanings hidden by default",
      "Tap 👁️ on any option to peek at the English meaning",
      "Speak your chosen reply or type it directly",
    ],
    color: "from-amber-500/20 to-amber-500/5",
    border: "border-amber-500/30",
  },
  {
    id: "advanced",
    emoji: "🔴",
    label: "Advanced",
    tagline: "I can hold a basic conversation",
    description:
      "You can navigate simple situations but want to stress-test your fluency in a high-pressure story where every word matters.",
    expects: [
      "No suggested replies — pure open conversation",
      "Characters speak naturally without slowing down",
      "No hints, no battery — just your voice",
    ],
    color: "from-rose-500/20 to-rose-500/5",
    border: "border-rose-500/30",
  },
];

// ── component ────────────────────────────────────────────────────────────────

export function TitleScreen({ story, courses, courseId, onCourse, canContinue, busy, error, onContinue, onNew }: {
  story: Story;
  courses: Course[];
  courseId: string;
  onCourse: (id: string) => void;
  canContinue: boolean;
  busy: boolean;
  error: string | null;
  onContinue: () => void;
  onNew: (name: string, difficulty: Difficulty) => void;
}) {
  const { t } = useI18n();
  // "cta" → "difficulty" → "name"
  const [step, setStep] = useState<"cta" | "difficulty" | "name">("cta");
  const [difficulty, setDifficulty] = useState<Difficulty>("beginner");
  const [name, setName] = useState("");
  const land = story.course.landing;
  const hero = story.cast.find((c) => c.id === land.character) ?? story.cast[0];
  const line = (i: number) => land.lines[i];
  const scene = (i: number) => land.feature_scenes[i] ?? land.scene;
  const sample = story.lessons.find((l) => l.candos.length > 0);
  const [f1, f2, f3] = t.features;

  return (
    <div className="h-full overflow-y-auto bg-cream">
      {/* ── hero ───────────────────────────────────────────────── */}
      <section className="relative m-2 h-[calc(100dvh-1rem)] overflow-hidden rounded-[26px] sm:m-3.5 sm:h-[calc(100dvh-1.75rem)]">
        <Backdrop scene={land.scene} />
        <Ambient kind={story.course.target_lang === "ja" ? "petals" : "dust"} />
        {/* keeps the headline legible over a bright sky */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_0%_0%,rgba(20,30,60,0.55),transparent_70%)]" />

        <NotchTab corner="tl"><Mark /></NotchTab>
        <NotchTab corner="tr">
          <span className="flex items-center gap-2 text-[15px]">
            <span className="hidden text-muted sm:inline">{t.iWantToLearn}</span>
            {courses.map((c) => (
              <button key={c.id} onClick={() => { audio.ui("tap"); onCourse(c.id); }} disabled={busy}
                className={`rounded-full px-2.5 py-0.5 transition ${c.id === courseId ? "bg-ink text-white" : "hover:text-shu"}`}>
                {c.label}
              </button>
            ))}
          </span>
        </NotchTab>
        <NotchTab corner="bl">
          <span className="flex items-center gap-1.5 text-[15px]">
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4 6l4 4 4-4" /></svg>
            {t.scrollDown}
          </span>
        </NotchTab>
        <div className="absolute bottom-4 right-5 z-10 hidden items-center gap-4 text-[15px] text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.5)] md:flex">
          <span className="flex items-center gap-1.5"><ClockIcon />{land.clock}</span>
          <span className="flex items-center gap-1.5"><PinIcon />{land.place}</span>
        </div>

        <div key={story.course.id} className="relative z-10 max-w-2xl px-6 pt-24 text-white sm:px-12 sm:pt-28">
          <motion.h1
            className="tight whitespace-pre-line text-[2.6rem] font-medium leading-[1.05] drop-shadow-[0_2px_20px_rgba(0,0,0,0.25)] sm:text-6xl"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9 }}
          >
            {land.title}
          </motion.h1>
          <motion.p className="tight mt-5 max-w-lg text-[16px] leading-snug text-white/95 drop-shadow"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
            {land.body}
          </motion.p>

          <div className="mt-8 min-h-[3.5rem]">
            <AnimatePresence mode="wait">
              {step === "cta" && (
                <motion.div key="cta" className="flex flex-wrap items-center gap-3"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.6 } }} exit={{ opacity: 0 }}>
                  <PillButton onClick={() => { audio.ui("choice"); setStep("difficulty"); }} disabled={busy}>{t.startTrip}</PillButton>
                  {canContinue && (
                    <button onClick={onContinue} disabled={busy}
                      className="smoke rounded-full px-5 py-2.5 text-[15px] font-medium transition hover:bg-black/40">
                      {t.continue}
                    </button>
                  )}
                </motion.div>
              )}

              {step === "difficulty" && (
                <motion.div key="difficulty"
                  className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <motion.div
                    className="w-full max-w-3xl rounded-[28px] bg-cream p-6 shadow-2xl sm:p-8"
                    initial={{ scale: 0.94, y: 24 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 220, damping: 22 }}
                  >
                    <h2 className="tight mb-1 text-center text-2xl font-medium text-ink sm:text-3xl">Choose your level</h2>
                    <p className="mb-6 text-center text-sm text-muted">You can change this anytime in Settings.</p>

                    <div className="grid gap-3 sm:grid-cols-3">
                      {DIFFICULTIES.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => { audio.ui("tap"); setDifficulty(d.id); }}
                          className={`relative rounded-2xl border-2 bg-gradient-to-b p-5 text-left transition ${d.color} ${d.border}
                            ${difficulty === d.id ? "ring-2 ring-offset-2 ring-ink/30 shadow-lg scale-[1.02]" : "opacity-80 hover:opacity-100 hover:shadow-md"}`}
                        >
                          {difficulty === d.id && (
                            <motion.span
                              layoutId="diff-check"
                              className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-ink text-[11px] text-white"
                            >✓</motion.span>
                          )}
                          <span className="mb-2 block text-2xl">{d.emoji}</span>
                          <span className="tight block text-lg font-semibold text-ink">{d.label}</span>
                          <span className="tight mt-0.5 block text-sm text-muted">{d.tagline}</span>
                          <p className="tight mt-3 text-[13px] leading-relaxed text-ink/70">{d.description}</p>
                          <ul className="mt-4 space-y-1.5">
                            {d.expects.map((e) => (
                              <li key={e} className="flex items-start gap-2 text-[12px] text-ink/60">
                                <span className="mt-0.5 shrink-0 text-[10px]">▸</span>
                                {e}
                              </li>
                            ))}
                          </ul>
                        </button>
                      ))}
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                      <button onClick={() => setStep("cta")} className="rounded-full px-5 py-2 text-sm text-muted hover:bg-cream-deep">
                        ← Back
                      </button>
                      <PillButton tone="dark" onClick={() => { audio.ui("choice"); setStep("name"); }}>
                        Continue →
                      </PillButton>
                    </div>
                  </motion.div>
                </motion.div>
              )}

              {step === "name" && (
                <motion.form key="name" className="frost flex max-w-md items-center gap-2 rounded-full py-1.5 pl-5 pr-1.5 text-ink"
                  initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  onSubmit={(e) => { e.preventDefault(); if (name.trim()) onNew(name.trim(), difficulty); }}>
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={24}
                    placeholder={t.namePlaceholder}
                    className="tight min-w-0 flex-1 bg-transparent text-[16px] placeholder:text-muted/70 focus:outline-none" />
                  <PillButton type="submit" disabled={!name.trim() || busy} tone="dark">{busy ? t.boarding : t.land}</PillButton>
                </motion.form>
              )}
            </AnimatePresence>
            {error && <p className="mt-3 text-sm text-white drop-shadow">{error}</p>}
          </div>
        </div>

        {/* the character, with voice bubbles */}
        {hero && (
          <motion.div
            key={hero.id}
            className="absolute bottom-0 right-[-18%] z-[5] h-[52%] sm:right-[14%] sm:h-[86%]"
            style={{ aspectRatio: "432 / 578", marginBottom: "-16%" }}
            initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5, type: "spring", stiffness: 60, damping: 16 }}
          >
            <motion.div className="h-full w-full" animate={{ y: [0, -5, 0] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={hero.sprite} alt={hero.name} draggable={false} className="h-full w-full object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.25)]" />
            </motion.div>
            <div className="hidden sm:block">
              {line(0) && <Bubble className="-left-[30%] top-[36%]" delay={1.2} jp={line(0).jp} en={line(0).en} />}
              {line(1) && <Bubble className="left-[48%] top-[50%]" delay={2} jp={line(1).jp} en={line(1).en} dark />}
            </div>
          </motion.div>
        )}
      </section>

      {/* ── below the fold ─────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pb-10 pt-24 text-center">
        <span className="pointer-events-none absolute inset-x-0 top-6 select-none font-jp text-[28vw] font-bold leading-none"
          style={{ background: "linear-gradient(to bottom, rgba(28,29,32,0.07), rgba(28,29,32,0))", WebkitBackgroundClip: "text", color: "transparent" }}>
          迷子
        </span>
        <h2 className="tight relative text-4xl font-medium sm:text-5xl">{t.notTextbook}</h2>
        <p className="tight relative mx-auto mt-4 max-w-xl text-lg text-muted">{t.notTextbookBody}</p>
      </section>

      <div className="mx-auto max-w-6xl space-y-24 px-6 pb-28 sm:px-10">
        <Feature n="01" title={f1.title} body={f1.body} scene={scene(0)}>
          {line(2) && <Bubble className="left-[12%] top-[16%]" jp={line(2).jp} en={line(2).en} dark static />}
          {line(3) && <Bubble className="right-[10%] top-[48%]" jp={line(3).jp} en={line(3).en} static />}
        </Feature>

        <Feature n="02" title={f2.title} body={f2.body} scene={scene(1)} flip>
          {sample && (
            <div className="frost absolute inset-x-[10%] top-[18%] rounded-2xl p-4 text-left text-ink">
              <span className="rounded-full bg-cream-deep px-2.5 py-0.5 text-xs text-muted">{t.lesson} {sample.index} · {t.iCan}</span>
              <ul className="mt-2 space-y-1 text-sm">
                {sample.candos.slice(0, 3).map((c, i) => (
                  <li key={c.id} className={i < 2 ? "text-ink" : "text-muted"}>{i < 2 ? "✓" : "○"} {c.text}</li>
                ))}
              </ul>
            </div>
          )}
        </Feature>

        <Feature n="03" title={f3.title} body={f3.body} scene={scene(2)}>
          {line(4) && (
            <div className="frost absolute right-[8%] top-[14%] w-[62%] rounded-2xl p-4 text-left text-ink">
              <span className="rounded-full bg-cream-deep px-2.5 py-0.5 text-xs text-muted">{t.senseiNote}</span>
              <p className="tight mt-2 text-sm text-ink/80">{t.gotItAcross}</p>
              <p className="mt-2 border-t border-hairline pt-2 font-jp text-lg">{line(4).jp}</p>
              <p className="tight text-sm text-muted">{line(4).en}</p>
            </div>
          )}
        </Feature>
      </div>

      <footer className="flex flex-col items-center gap-3 border-t border-hairline px-6 py-10 text-center text-sm text-muted">
        <Mark small />
        <p>{t.footer}</p>
      </footer>
    </div>
  );
}

function Bubble({ jp, en, className, delay = 0, dark, static: still }: {
  jp: string; en: string; className: string; delay?: number; dark?: boolean; static?: boolean;
}) {
  return (
    <motion.div
      className={`absolute z-10 w-max max-w-[16rem] rounded-2xl px-4 py-2.5 text-center ${dark ? "smoke" : "frost text-ink"} ${className}`}
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true }}
      animate={still ? undefined : { y: [0, -4, 0] }}
      transition={{ delay, duration: still ? 0.6 : 4, repeat: still ? 0 : Infinity, ease: "easeInOut" }}
    >
      <div className="flex justify-center border-b pb-1.5" style={{ borderColor: dark ? "rgba(255,255,255,.2)" : "rgba(28,29,32,.08)" }}>
        <Waveform active light={dark} bars={13} />
      </div>
      <p className="mt-1.5 font-jp text-[15px]">{jp}</p>
      <p className="tight text-sm opacity-80">{en}</p>
    </motion.div>
  );
}

function Feature({ n, title, body, scene, flip, children }: {
  n: string; title: string; body: string; scene: string; flip?: boolean; children: React.ReactNode;
}) {
  return (
    <motion.div className={`grid items-center gap-10 md:grid-cols-2 ${flip ? "md:[&>*:first-child]:order-2" : ""}`}
      initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8 }}>
      <div>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-cream-deep text-base">{n}</span>
        <h3 className="tight mt-5 text-4xl font-medium">{title}</h3>
        <p className="tight mt-4 max-w-md text-lg leading-relaxed text-muted">{body}</p>
      </div>
      <div className="relative aspect-[16/10] overflow-hidden rounded-[22px] shadow-[0_30px_60px_rgba(28,29,32,0.18)]">
        <Backdrop scene={scene} />
        <NotchTab corner={flip ? "bl" : "tr"}><span className="block h-3 w-20" /></NotchTab>
        {children}
      </div>
    </motion.div>
  );
}
