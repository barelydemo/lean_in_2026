"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ExitView, InputVia, Phrase } from "@/lib/types";
import type { Assist } from "./DialogueBox";
import type { Difficulty } from "./Settings";
import { audio } from "@/lib/audio/engine";
import { useI18n } from "@/lib/i18n";

interface Props {
  choices: Phrase[];
  assist: Assist;
  difficulty: Difficulty;
  voiceEnabled: boolean;
  recording: boolean;
  level: number;
  transcribing: boolean;
  micError: string | null;
  hint: string | null;
  /** Suggestions are locked until bought with translator battery. */
  hintCost: number;
  battery: number;
  onUnlockHint: () => void;
  /** Places the player can walk to right now. */
  exits: ExitView[];
  onTravel: (to: string) => void;
  onStartTalk: () => void;
  onStopTalk: () => void;
  onSend: (text: string, via: InputVia) => void;
  /** Called when the player peeks at a meaning (👁️); counts as a hint for scoring. */
  onReveal: () => void;
  /** Plays a phrase using the character's native TTS voice (or browser fallback). */
  onPreviewVoice?: (text: string) => Promise<void>;
  /** Notifies parent which target card is currently selected for Levenshtein pronunciation comparison. */
  onSelectChoice?: (choice: Phrase | null) => void;
}

export function ReplyDock(p: Props) {
  const { t } = useI18n();
  const held = useRef(false);
  // Latest props for the key handlers, which are registered once.
  const props = useRef(p);
  useEffect(() => { props.current = p; });

  // ── Beginner shadowing state ──────────────────────────────────────────
  // When a beginner clicks a choice, we enter "shadow" mode: play audio,
  // then prompt them to repeat it before actually sending.
  const [shadowChoice, setShadowChoice] = useState<Phrase | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);

  // ── Intermediate: per-choice meaning reveal ───────────────────────────
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  // Reset shadowing / reveal state whenever a new set of choices arrives
  useEffect(() => {
    setShadowChoice(null);
    p.onSelectChoice?.(null);
    setRevealed(new Set());
    setAudioPlaying(false);
    audioRef.current?.pause();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.choices]);

  useEffect(() => {
    p.onSelectChoice?.(shadowChoice);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shadowChoice]);

  // ── Picking a card: the player must then SPEAK it (no typing, no auto-send).
  const playBrowserVoice = (text: string) => {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = 0.85;
    // Prefer a natural Japanese voice if available
    const voices = speechSynthesis.getVoices();
    const jpVoice = voices.find((v) => v.lang.startsWith("ja") && /natural|enhanced|premium|kyoko|nanami|otoya/i.test(v.name))
      ?? voices.find((v) => v.lang.startsWith("ja"));
    if (jpVoice) utter.voice = jpVoice;
    utter.onstart = () => setAudioPlaying(true);
    utter.onend = () => setAudioPlaying(false);
    speechSynthesis.speak(utter);
    setAudioPlaying(true);
  };

  const playPreviewVoice = async (text: string) => {
    if (props.current.onPreviewVoice) {
      setAudioPlaying(true);
      try {
        await props.current.onPreviewVoice(text);
      } finally {
        setAudioPlaying(false);
      }
      return;
    }
    playBrowserVoice(text);
  };

  // Beginner also hears the line once first (shadowing); Intermediate does not.
  const handleChoiceClick = (choice: Phrase) => {
    audio.ui("choice");
    setShadowChoice(choice);
    if (props.current.difficulty === "beginner") void playPreviewVoice(choice.jp);
  };

  // Hold Space to talk; 1–3 picks a suggested reply.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const p = props.current;
      const n = Number(e.key);
      const el = document.activeElement;
      // Any text box (e.g. the dictionary's) means the player is typing there.
      const inInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      // Digits pick a suggestion to speak (Beginner / Intermediate only).
      if (n >= 1 && n <= p.choices.length && !inInput) {
        e.preventDefault();
        if (p.difficulty === "advanced") return; // no choices in advanced
        handleChoiceClick(p.choices[n - 1]);
        return;
      }
      if (inInput) return;
      if (e.code === "Space") {
        e.preventDefault(); // never scroll or "click" a focused button
        if (p.voiceEnabled && !e.repeat && !held.current) {
          held.current = true;
          p.onStartTalk();
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && held.current) {
        e.preventDefault();
        held.current = false;
        props.current.onStopTalk();
      }
    };
    // Releasing Space after switching windows never fires keyup.
    const blur = () => {
      if (held.current) {
        held.current = false;
        props.current.onStopTalk();
      }
    };
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const replayVoice = () => {
    if (!shadowChoice) return;
    void playPreviewVoice(shadowChoice.jp);
  };

  const cancelShadow = () => {
    speechSynthesis?.cancel();
    setShadowChoice(null);
    setAudioPlaying(false);
  };

  const status = p.micError
    ? p.micError
    : p.transcribing
      ? t.listeningBack
      : p.recording
        ? t.speakNow
        : t.holdToTalk;

  const showChoices = p.difficulty !== "advanced" && p.choices.length > 0;
  const showHintButton = p.difficulty !== "advanced" && p.choices.length === 0;

  return (
    <motion.div
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-3 sm:px-6"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: "spring", stiffness: 150, damping: 20 }}
    >
      <AnimatePresence>
        {p.hint && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="frost flex items-center gap-2 rounded-full px-4 py-1.5 text-sm">
            <span className="h-2 w-2 rounded-full bg-shu" />
            {p.hint}
          </motion.div>
        )}
      </AnimatePresence>

      {(p.exits ?? []).some((e) => e.open) && (
        <div className="flex w-full flex-wrap justify-center gap-1.5">
          {(p.exits ?? []).filter((e) => e.open).map((e) => (
            <motion.button
              key={e.to}
              onClick={() => p.onTravel(e.to)}
              onPointerEnter={() => audio.ui("hover")}
              className="smoke flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] transition hover:bg-black/50"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              title={e.label}
            >
              <span className="text-white/60">{t.go}</span> → {e.name}
            </motion.button>
          ))}
        </div>
      )}

      {/* ── Advanced: no choices, no hint button — just the mic ─────────── */}
      {p.difficulty === "advanced" && (
        <motion.p className="text-xs text-white/60 drop-shadow" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          Speak freely — no hints in Advanced mode
        </motion.p>
      )}

      {/* ── Hint unlock button (Beginner / Intermediate, no choices yet) ── */}
      {showHintButton && (
        <motion.button
          onClick={p.onUnlockHint}
          disabled={p.battery < p.hintCost}
          className="frost flex items-center gap-2 rounded-full px-4 py-1.5 text-sm text-ink transition hover:bg-white disabled:opacity-50"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-[10px] text-white">H</span>
          {p.battery < p.hintCost ? t.batteryTooLow : t.stuckHint(p.hintCost)}
        </motion.button>
      )}

      {/* ── Speak panel (Beginner / Intermediate): pick a line, then say it ── */}
      <AnimatePresence>
        {p.difficulty !== "advanced" && shadowChoice && (
          <motion.div
            key="shadow"
            className="frost w-full rounded-2xl p-4 text-ink"
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-medium text-emerald-700">
                {p.difficulty === "beginner" ? "🎤 Now repeat out loud" : "🎤 Say it out loud"}
              </span>
              <button onClick={cancelShadow} className="text-xs text-muted hover:text-ink">← back</button>
            </div>

            {/* The phrase to say */}
            <div className="mb-4 rounded-xl bg-cream-deep px-4 py-3 text-center">
              <p className="font-jp text-xl font-medium text-ink">{shadowChoice.jp}</p>
              {shadowChoice.romaji && <p className="mt-1 text-sm text-shu">{shadowChoice.romaji}</p>}
              {p.difficulty === "beginner" || revealed.has(shadowChoice.jp) ? (
                <p className="mt-0.5 text-sm text-muted">"{shadowChoice.en}"</p>
              ) : (
                <button
                  onClick={() => { setRevealed((s) => new Set([...s, shadowChoice.jp])); p.onReveal(); audio.ui("tap"); }}
                  className="mt-1 rounded-full bg-white/70 px-2.5 py-0.5 text-[12px] text-muted hover:text-ink"
                >
                  👁️ Show meaning
                </button>
              )}
            </div>

            {/* Listen again (Beginner only) */}
            {p.difficulty === "beginner" && (
              <div className="mb-3 flex justify-center">
                <button
                  onClick={replayVoice}
                  disabled={audioPlaying}
                  className="flex items-center gap-2 rounded-full border border-hairline px-4 py-1.5 text-sm text-ink transition hover:bg-cream-deep disabled:opacity-50"
                >
                  {audioPlaying ? (
                    <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
                      🔊 Playing…
                    </motion.span>
                  ) : (
                    <>🔊 Listen again</>
                  )}
                </button>
              </div>
            )}

            {/* Mic area */}
            <div className="flex items-center gap-3">
              <MicButton recording={p.recording} level={p.level} busy={p.transcribing} onDown={p.onStartTalk} onUp={p.onStopTalk} />
              <div className="frost flex flex-1 items-center justify-between rounded-full py-2 pl-5 pr-2">
                <span className="text-sm text-muted">
                  {p.transcribing ? t.listeningBack : p.recording ? "Listening… release when done" : "Hold Space or the mic to speak"}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Choice cards (Beginner / Intermediate) ──────────────────────── */}
      {showChoices && !shadowChoice && (
        <div className="grid w-full gap-2 sm:grid-cols-3">
          {p.choices.map((c, i) => (
            <ChoiceCard
              key={c.jp}
              choice={c}
              index={i}
              difficulty={p.difficulty}
              revealed={revealed.has(c.jp)}
              onReveal={() => { setRevealed((s) => new Set([...s, c.jp])); p.onReveal(); }}
              onSelect={() => handleChoiceClick(c)}
            />
          ))}
        </div>
      )}

      {/* ── Mic bar (voice only) ────────────────────────────────────────── */}
      {!shadowChoice && (
        <div className="flex w-full items-center gap-3">
          <MicButton recording={p.recording} level={p.level} busy={p.transcribing} onDown={p.onStartTalk} onUp={p.onStopTalk} />
          <div className="frost flex flex-1 items-center rounded-full py-2 pl-5 pr-2">
            <span className="text-sm text-muted">{status}</span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── ChoiceCard ────────────────────────────────────────────────────────────────

function getChoiceIntent(choice: Phrase, index: number): { label: string; className: string } {
  const jp = choice.jp;
  const en = choice.en.toLowerCase();
  const isTravel =
    /行きます|行く|行きましょう|行こう|向かいます|帰ります|戻ります|いこう|いきます/.test(jp) ||
    /\b(go to|head to|going to|walk to|leave for|take the train)\b/.test(en);
  if (isTravel) {
    return {
      label: "🚪 Leave / Next Scene",
      className: "bg-indigo-50 text-indigo-700 border border-indigo-200/80",
    };
  }
  const isQuestion =
    /[？?]/.test(jp) ||
    /[？?]/.test(choice.en) ||
    /ですか|どこ|いくら|どう|なに|なん/.test(jp);
  if (isQuestion && index !== 0) {
    return {
      label: "💬 Ask / Explore",
      className: "bg-sky-50 text-sky-700 border border-sky-200/80",
    };
  }
  if (index === 0) {
    return {
      label: "🎯 Story Progress",
      className: "bg-amber-50 text-amber-800 border border-amber-200/80",
    };
  }
  if (isQuestion) {
    return {
      label: "💬 Ask / Explore",
      className: "bg-sky-50 text-sky-700 border border-sky-200/80",
    };
  }
  return {
    label: "✨ Reply / Continue",
    className: "bg-stone-100 text-stone-700 border border-stone-200/80",
  };
}

function ChoiceCard({ choice, index, difficulty, revealed, onReveal, onSelect }: {
  choice: Phrase;
  index: number;
  difficulty: Difficulty;
  revealed: boolean;
  onReveal: () => void;
  onSelect: () => void;
}) {
  const intent = getChoiceIntent(choice, index);
  return (
    <motion.div
      className="frost group relative rounded-2xl px-4 py-3 text-left transition hover:bg-white/90"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index }}
      whileHover={{ y: -3 }}
    >
      {/* Top row: Intent badge + index badge */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${intent.className}`}>
          {intent.label}
        </span>
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cream-deep text-[11px] text-muted">{index + 1}</span>
      </div>

      {/* Beginner: meaning always visible */}
      {difficulty === "beginner" && (
        <span className="tight mb-1 block pr-6 text-[14px] font-medium leading-snug text-ink">"{choice.en}"</span>
      )}

      {/* Intermediate: meaning hidden behind 👁️ toggle */}
      {difficulty === "intermediate" && (
        <div className="mb-1 flex items-center gap-1.5 pr-6">
          {revealed ? (
            <span className="tight block text-[14px] font-medium leading-snug text-ink">"{choice.en}"</span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onReveal(); audio.ui("tap"); }}
              className="relative z-10 flex items-center gap-1 rounded-full bg-cream-deep px-2.5 py-0.5 text-[12px] text-muted hover:text-ink"
            >
              👁️ Show meaning
            </button>
          )}
        </div>
      )}

      {choice.romaji && (
        <span className="mt-0.5 block text-[15px] leading-snug text-shu">{choice.romaji}</span>
      )}
      <span className="block font-jp text-sm leading-snug text-muted">{choice.jp}</span>

      {/* Click overlay; the 👁️ button above sits over it (z-10) so it stays clickable */}
      <button
        className="absolute inset-0 rounded-2xl"
        onClick={onSelect}
        aria-label={choice.en}
      />

      {/* Beginner: listen badge */}
      {difficulty === "beginner" && (
        <span className="relative z-10 mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] text-emerald-600">
          🔊 Tap to listen &amp; shadow
        </span>
      )}
    </motion.div>
  );
}

// ── MicButton ─────────────────────────────────────────────────────────────────

function MicButton({ recording, level, busy, onDown, onUp }: {
  recording: boolean; level: number; busy: boolean; onDown: () => void; onUp: () => void;
}) {
  return (
    <motion.button
      aria-label="Hold to talk"
      className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full bg-shu text-white shadow-[0_10px_30px_rgba(200,32,47,0.4)] ring-4 ring-white/70"
      onPointerDown={(e) => { e.preventDefault(); onDown(); }}
      onPointerUp={onUp}
      onPointerLeave={() => recording && onUp()}
      whileTap={{ scale: 0.92 }}
      animate={{ backgroundColor: recording ? "#9e1622" : "#c8202f" }}
      disabled={busy}
    >
      {recording && [0, 1].map((i) => (
        <motion.span key={i} className="absolute inset-0 rounded-full border-2 border-shu"
          animate={{ scale: 1.1 + level * (0.6 + i * 0.5), opacity: 0.7 - i * 0.3 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }} />
      ))}
      {busy ? (
        <motion.span className="h-6 w-6 rounded-full border-[3px] border-white/30 border-t-white"
          animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
      ) : (
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
          <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 1 0-7 0v6A3.5 3.5 0 0 0 12 15Z" />
          <path d="M18.5 11.5a.75.75 0 0 0-1.5 0 5 5 0 0 1-10 0 .75.75 0 0 0-1.5 0 6.5 6.5 0 0 0 5.75 6.46V20.5h-2.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-2.5v-2.54a6.5 6.5 0 0 0 5.75-6.46Z" />
        </svg>
      )}
    </motion.button>
  );
}
