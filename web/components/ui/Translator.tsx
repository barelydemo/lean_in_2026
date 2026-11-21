"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Device, Gloss, GlossWord, GrammarPoint, Translation } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { ArrowDot } from "./Frame";

/** One-character language names for the device's keys: 英→日 etc. */
const SHORT: Record<string, string> = { en: "英", ja: "日" };
const direction = (from: string, to: string) => `${SHORT[from] ?? from}→${SHORT[to] ?? to}`;

const SEEN_KEY = "lexical.dictionary.seen";

interface Props {
  device: Device;
  battery: number;
  canScan: boolean;
  canHint: boolean;
  hintUnlocked: boolean;
  busy: "scan" | "hint" | "translate" | null;
  phraseOpen: boolean;
  wordsKnown: number;
  wordsMastered: number;
  onScan: () => void;
  onHint: () => void;
  onPhrase: () => void;
  onReplay: (() => void) | null;
}

/** The player's battered 1998 electronic dictionary. */
export function Translator(p: Props) {
  const { t, lang, target } = useI18n();
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!localStorage.getItem(SEEN_KEY)) setFresh(true);
    } catch {}
  }, []);
  const used = () => {
    if (!fresh) return;
    setFresh(false);
    try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
  };
  // Keyboard shortcuts count as using it too.
  if (fresh && p.busy) used();

  const dead = p.battery <= 0;
  const low = p.battery < 15;
  const bars = Math.ceil(Math.max(0, p.battery) / 25); // 0–4 segments, like a real LCD

  return (
    <motion.div
      className="pointer-events-auto absolute bottom-4 left-4 z-30 w-[14.5rem] sm:bottom-6 sm:left-6"
      initial={{ y: 30, opacity: 0, rotate: -4 }}
      animate={{ y: 0, opacity: 1, rotate: -2 }}
      transition={{ type: "spring", stiffness: 120, damping: 16 }}
    >
      {fresh && (
        <motion.div className="absolute -top-16 left-0 w-64 rounded-2xl bg-cream px-3 py-2 text-xs leading-snug text-ink shadow-xl"
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }}>
          {t.dictTip}
        </motion.div>
      )}
      {/* clamshell body */}
      <div className="relative rounded-[18px] bg-gradient-to-b from-[#3b3f4a] to-[#24262d] p-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/10">
        <div className="mb-1.5 flex items-center justify-between px-1 text-[9px] uppercase tracking-[0.2em] text-white/45">
          <span>{p.device.name}</span>
          <span>{p.device.name_jp}</span>
        </div>

        {/* LCD */}
        <div className="relative overflow-hidden rounded-md bg-[#a9b98a] px-2.5 py-1.5 font-[family-name:var(--font-lcd)] text-[#2a3320] shadow-[inset_0_2px_6px_rgba(0,0,0,0.35)]">
          <svg viewBox="0 0 200 60" className="pointer-events-none absolute inset-0 h-full w-full opacity-30" preserveAspectRatio="none">
            <path d="M160 0 L148 22 L170 34 L141 60 M148 22 L120 26" stroke="#2a3320" strokeWidth="0.7" fill="none" />
          </svg>
          <div className="relative flex items-center justify-between text-[11px]">
            <span>{dead ? "BATT EMPTY" : `単語 ${p.wordsKnown}  ✓${p.wordsMastered}`}</span>
            <motion.span className="flex items-center gap-[2px]"
              animate={low && !dead ? { opacity: [1, 0.2, 1] } : { opacity: 1 }}
              transition={{ duration: 1, repeat: low && !dead ? Infinity : 0 }}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`h-2 w-1.5 ${i < bars ? "bg-[#2a3320]" : "bg-[#2a3320]/20"}`} />
              ))}
              <span className="ml-0.5 h-1 w-[2px] bg-[#2a3320]" />
            </motion.span>
          </div>
          <p className="relative mt-0.5 truncate text-[12px]">
            {dead ? "電池を交換してください" : p.busy === "scan" ? "検索中…" : p.busy === "hint" ? "会話集…" : p.busy === "translate" ? "翻訳中…" : "ことばを しらべる"}
          </p>
        </div>

        <div className="mt-2 grid grid-cols-4 gap-1.5">
          <Key label={t.lookUp} jp="辞書" kbd="S" cost={p.device.scan_cost} pulse={fresh}
            disabled={!p.canScan || p.busy !== null} onClick={() => { used(); p.onScan(); }} />
          <Key label={p.hintUnlocked ? t.hints : t.phrases} jp="会話" kbd="H" cost={p.hintUnlocked ? 0 : p.device.hint_cost}
            disabled={!p.canHint || p.hintUnlocked || p.busy !== null} onClick={() => { used(); p.onHint(); }} />
          <Key label={p.phraseOpen ? t.close : t.sayIt} jp={direction(lang, target)} kbd="T" cost={p.device.translate_cost}
            disabled={p.busy !== null && p.busy !== "translate"} onClick={() => { used(); p.onPhrase(); }} />
          <Key label={t.again} jp="再生" kbd="R" cost={0} disabled={!p.onReplay} onClick={() => p.onReplay?.()} />
        </div>
      </div>
    </motion.div>
  );
}

function Key({ label, jp, kbd, cost, disabled, pulse, onClick }: {
  label: string; jp: string; kbd: string; cost: number; disabled?: boolean; pulse?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="relative rounded-lg bg-[#4a4f5c] px-1 py-1.5 text-center text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.35)] transition active:translate-y-px active:shadow-none disabled:opacity-35">
      {pulse && !disabled && (
        <motion.span className="absolute inset-0 rounded-lg ring-2 ring-shu"
          animate={{ opacity: [0.9, 0.2, 0.9] }} transition={{ duration: 1.4, repeat: Infinity }} />
      )}
      <span className="block font-jp text-[13px] leading-none">{jp}</span>
      <span className="mt-0.5 block text-[10px] leading-none text-white/75">{label}</span>
      <span className="mt-0.5 block text-[9px] leading-none text-white/40">{kbd}{cost ? ` · ${cost}%` : ""}</span>
    </button>
  );
}

const KIND_COLOR: Record<string, string> = {
  noun: "#3d7fe0", verb: "#c8202f", adjective: "#d9822b", adverb: "#a05fd0", particle: "#7d8088",
  copula: "#2fa35a", question: "#2fa35a", expression: "#d4458a", name: "#3d7fe0", number: "#3d7fe0", other: "#7d8088",
};

/**
 * The dictionary's word map: every entry with its reading, meaning and job
 * in the sentence. There is no sentence translation — working out what was
 * said from the pieces is the lesson.
 */
export function GlossCard({ gloss, grammar, onClose }: {
  gloss: Gloss | null;
  grammar: Record<string, GrammarPoint>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const notes = gloss?.words.filter((w) => w.note) ?? [];
  return (
    <AnimatePresence>
      {gloss && (
        <motion.div
          className="relative mx-auto w-full max-w-3xl px-3 sm:px-6"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6 }}
        >
          <div className="frost rounded-[22px] px-5 py-3.5 text-ink" onClick={onClose}>
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span className="font-[family-name:var(--font-lcd)]">辞書 · {gloss.words.length}</span>
              <span>{t.tapToClose}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-x-2.5 gap-y-3">
              {gloss.words.map((w, i) => (
                <Entry key={i} w={w} i={i} grammar={grammar} />
              ))}
            </div>
            {notes.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-hairline pt-2 text-[13px] leading-snug text-ink/80">
                {notes.map((w, i) => (
                  <li key={i}><span className="font-jp font-medium">{w.jp}</span> — {w.note}</li>
                ))}
              </ul>
            )}
            <p className="tight mt-2.5 text-[13px] text-muted">{t.piece}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * "How do I say…?" — the player holds the mic (or Space) to speak their English
 * query aloud, and gets a Japanese line to read aloud with its word map.
 */
export function PhrasePanel({ result, busy, recording, transcribing, level = 0, typing, cost, battery, grammar, onStartTalk, onStopTalk, onAsk, onSay, onClose }: {
  result: Translation | null;
  busy: boolean;
  recording: boolean;
  transcribing?: boolean;
  level?: number;
  /** No microphone: ask by typing instead. */
  typing: boolean;
  cost: number;
  battery: number;
  grammar: Record<string, GrammarPoint>;
  onStartTalk: () => void;
  onStopTalk: () => void;
  onAsk: (question: string) => void;
  onSay: (jp: string) => void;
  onClose: () => void;
}) {
  const { t, lang, target } = useI18n();
  const [text, setText] = useState("");
  const lowBattery = battery < cost;
  const working = busy || !!transcribing;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const ask = text.trim();
    if (ask && !working && !lowBattery) onAsk(ask);
  };

  return (
    <motion.div className="relative mx-auto w-full max-w-3xl px-3 sm:px-6"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
      <div className="frost rounded-[22px] px-5 py-4 text-ink">
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span className="font-[family-name:var(--font-lcd)]">{direction(lang, target)} · {t.howDoISay} · {cost}%</span>
          <button onClick={onClose} className="rounded-full px-2 text-base leading-none hover:text-ink" aria-label={t.close}>×</button>
        </div>

        {typing ? (
          <form onSubmit={submit} className="mt-2.5 flex items-center gap-2 rounded-full bg-white/80 py-1 pl-4 pr-1">
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={200}
              placeholder={lowBattery ? t.batteryTooLow : t.askPlaceholder}
              className="tight min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-muted/70 focus:outline-none" />
            <button type="submit" disabled={!text.trim() || working || lowBattery} aria-label={t.howDoISay} className="disabled:opacity-40">
              {working ? (
                <motion.span className="block h-8 w-8 rounded-full border-[3px] border-ink/20 border-t-ink"
                  animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
              ) : (
                <ArrowDot dark />
              )}
            </button>
          </form>
        ) : (
          <div className="mt-2.5 flex items-center gap-3 rounded-full bg-white/80 py-2 pl-2.5 pr-4">
            <motion.button
              type="button"
              aria-label={t.askHold}
              disabled={working || lowBattery}
              onPointerDown={(e) => { e.preventDefault(); onStartTalk(); }}
              onPointerUp={onStopTalk}
              onPointerLeave={() => recording && onStopTalk()}
              whileTap={{ scale: 0.92 }}
              animate={{ backgroundColor: recording ? "#9e1622" : "#c8202f" }}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-shu text-white shadow-md disabled:opacity-40"
            >
              {recording && (
                <motion.span className="absolute inset-0 rounded-full border-2 border-shu"
                  animate={{ scale: 1.15 + level * 0.5, opacity: 0.6 }} transition={{ type: "spring", stiffness: 300, damping: 15 }} />
              )}
              {working ? (
                <motion.span className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white"
                  animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 1 0-7 0v6A3.5 3.5 0 0 0 12 15Z" />
                  <path d="M18.5 11.5a.75.75 0 0 0-1.5 0 5 5 0 0 1-10 0 .75.75 0 0 0-1.5 0 6.5 6.5 0 0 0 5.75 6.46V20.5h-2.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-2.5v-2.54a6.5 6.5 0 0 0 5.75-6.46Z" />
                </svg>
              )}
            </motion.button>
            <div className="min-w-0 flex-1">
              <p className="tight text-[15px] font-medium text-ink">
                {lowBattery ? t.batteryTooLow : recording ? t.listening : working ? t.translating : t.askHold}
              </p>
              <p className="text-xs text-muted">{t.askExample}</p>
            </div>
          </div>
        )}

        {result && (
          <motion.div className="mt-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p className="text-[11px] uppercase tracking-wider text-muted">{t.sayThis}</p>
            <p className="mt-0.5 text-2xl font-medium leading-snug text-shu">{result.romaji}</p>
            <p className="font-jp text-lg">{result.jp}</p>
            <p className="tight text-sm text-muted">“{result.en}”</p>
            <div className="mt-2.5 flex flex-wrap items-end gap-x-2 gap-y-2">
              {result.words.map((w, i) => <Entry key={i} w={w} i={i} grammar={grammar} />)}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted">{t.readAloud}</p>
              <button onClick={() => onSay(result.jp)}
                className="rounded-full bg-ink px-4 py-1.5 text-sm text-cream transition hover:bg-ink/85">{t.sendIt}</button>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function Entry({ w, i, grammar }: { w: GlossWord; i: number; grammar: Record<string, GrammarPoint> }) {
  const { t } = useI18n();
  const k = { label: (t.kinds as Record<string, string>)[w.kind] ?? "", color: KIND_COLOR[w.kind] ?? KIND_COLOR.other };
  const g = w.grammar_id !== "none" ? grammar[w.grammar_id] : undefined;
  const particle = w.kind === "particle";
  return (
    <motion.div
      className={`flex flex-col items-start rounded-xl px-2 py-1 ${particle ? "bg-cream-deep/80" : "bg-white/70"}`}
      style={{ borderBottom: `2px solid ${k.color}` }}
      initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ delay: 0.05 * i }}
    >
      {k.label && <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: k.color }}>{k.label}</span>}
      <span className={`font-jp leading-tight ${particle ? "text-base" : "text-lg"}`}>{w.jp}</span>
      <span className="text-[11px] text-muted">{w.romaji}</span>
      <span className="tight text-[13px] font-medium">{w.en}</span>
      {g && <span className="mt-0.5 rounded-full bg-shu px-1.5 font-jp text-[10px] text-white">{g.pattern}</span>}
    </motion.div>
  );
}
