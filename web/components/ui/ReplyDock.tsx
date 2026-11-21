"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ExitView, InputVia, Phrase } from "@/lib/types";
import type { Assist } from "./DialogueBox";
import type { Difficulty } from "./Settings";
import { audio } from "@/lib/audio/engine";
import { useI18n, type Strings } from "@/lib/i18n";
import { ArrowDot } from "./Frame";

interface Props {
  choices: Phrase[];
  assist: Assist;
  difficulty: Difficulty;
  voiceEnabled: boolean;
  /** No microphone (or the player chose to type): a text box replaces the mic. */
  typing: boolean;
  recording: boolean;
  level: number;
  transcribing: boolean;
  micError: string | null;
  hint: string | null;
  /** Suggestions are locked until bought with translator battery. */
  hintCost: number;
  battery: number;
  onUnlockHint: () => void;
  /** People here the player can walk up to (minus whoever they're talking with). */
  people: { id: string; name: string; color: string }[];
  onApproach: (id: string) => void;
  onLook: () => void;
  /** Places the player can walk to right now. */
  exits: ExitView[];
  onTravel: (to: string) => void;
  onStartTalk: () => void;
  onStopTalk: () => void;
  onSend: (text: string, via: InputVia) => void;
  /** Plays a phrase in a character's voice (or the browser's). */
  onPreviewVoice?: (text: string) => Promise<void>;
  /** The card the player is about to say, for pronunciation comparison. */
  onSelectChoice?: (choice: Phrase | null) => void;
}

export function ReplyDock(p: Props) {
  const { t, target } = useI18n();
  const held = useRef(false);
  // Latest props for the key handlers, which are registered once.
  const props = useRef(p);
  useEffect(() => { props.current = p; });

  // Beginners pick a card, hear it, then say it (shadowing).
  const [shadowChoice, setShadowChoice] = useState<Phrase | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // A new set of choices starts fresh.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShadowChoice(null);
    setAudioPlaying(false);
    p.onSelectChoice?.(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.choices]);

  useEffect(() => {
    p.onSelectChoice?.(shadowChoice);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shadowChoice]);

  useEffect(() => {
    if (p.typing) inputRef.current?.focus();
  }, [p.typing, shadowChoice]);

  const playBrowserVoice = (line: string) => {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(line);
    utter.lang = target === "en" ? "en-US" : "ja-JP";
    utter.rate = 0.85;
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(target));
    utter.voice = voices.find((v) => /natural|enhanced|premium/i.test(v.name)) ?? voices[0] ?? null;
    utter.onend = () => setAudioPlaying(false);
    setAudioPlaying(true);
    speechSynthesis.speak(utter);
  };

  const playPreviewVoice = async (line: string) => {
    const preview = props.current.onPreviewVoice;
    if (!preview) return playBrowserVoice(line);
    setAudioPlaying(true);
    try {
      await preview(line);
    } finally {
      setAudioPlaying(false);
    }
  };

  const pick = (choice: Phrase) => {
    audio.ui("choice");
    // Beginners shadow the line out loud; everyone else (and anyone typing)
    // sends the card as is — the classic phrase-book reply.
    if (props.current.difficulty !== "beginner" || props.current.typing) {
      props.current.onSend(choice.jp, "choice");
      return;
    }
    setShadowChoice(choice);
    void playPreviewVoice(choice.jp);
  };

  // Hold Space to talk; 1–3 picks a suggested reply.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const p = props.current;
      const n = Number(e.key);
      const el = document.activeElement;
      const inInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      const emptyOwnInput = el === inputRef.current && !inputRef.current?.value;
      if (n >= 1 && n <= p.choices.length && (!inInput || emptyOwnInput) && p.difficulty !== "advanced") {
        e.preventDefault();
        pick(p.choices[n - 1]);
        return;
      }
      if (inInput) return;
      if (e.code === "Space") {
        e.preventDefault(); // never scroll or "click" a focused button
        if (p.voiceEnabled && !p.typing && !e.repeat && !held.current) {
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

  const submit = () => {
    const said = text.trim();
    if (!said) return;
    setText("");
    p.onSend(said, "text");
  };

  const status = p.micError ?? (p.transcribing ? t.listeningBack : p.recording ? t.speakNow : t.holdToTalk);
  const showChoices = p.difficulty !== "advanced" && p.choices.length > 0;
  const showHintButton = p.difficulty !== "advanced" && p.choices.length === 0;
  const openExits = (p.exits ?? []).filter((e) => e.open);

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

      {!shadowChoice && (
        <div className="flex w-full flex-wrap justify-center gap-1.5">
          {p.people.map((c) => (
            <motion.button
              key={c.id}
              onClick={() => p.onApproach(c.id)}
              onPointerEnter={() => audio.ui("hover")}
              className="frost flex items-center gap-2 rounded-full py-1 pl-1.5 pr-3.5 text-[13px] text-ink transition hover:bg-white"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -2 }}
            >
              <span className="grid h-5 w-5 place-items-center rounded-full text-[10px] text-white" style={{ background: c.color }}>
                {c.name.charAt(0)}
              </span>
              <span className="text-muted">{t.talkTo}</span>
              <span className="font-medium">{c.name}</span>
            </motion.button>
          ))}
          <motion.button
            onClick={p.onLook}
            onPointerEnter={() => audio.ui("hover")}
            className="smoke rounded-full px-3 py-1 text-[13px] text-white/80 transition hover:bg-black/50"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          >
            {t.lookAround}
          </motion.button>
          {openExits.map((e) => (
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

      {p.difficulty === "advanced" && (
        <p className="text-xs text-white/70 drop-shadow">{t.advancedNoHints}</p>
      )}

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

      {/* Picked a card: say it out loud. */}
      <AnimatePresence>
        {shadowChoice && (
          <motion.div
            key="shadow"
            className="frost w-full rounded-[22px] px-5 py-4 text-ink"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          >
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span className="flex items-center gap-1.5 uppercase tracking-wider">
                <span className="h-1.5 w-1.5 rounded-full bg-shu" />
                {t.repeatAloud}
              </span>
              <button onClick={() => { speechSynthesis?.cancel(); setShadowChoice(null); }} className="rounded-full px-2 hover:text-ink">
                ← {t.back}
              </button>
            </div>
            <div className="mt-2 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="font-jp text-2xl font-medium leading-snug">{shadowChoice.jp}</p>
                {shadowChoice.romaji && <p className="text-[15px] text-shu">{shadowChoice.romaji}</p>}
                <p className="tight text-sm text-muted">“{shadowChoice.en}”</p>
              </div>
              <button
                onClick={() => void playPreviewVoice(shadowChoice.jp)}
                disabled={audioPlaying}
                aria-label={t.listen}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-sm transition hover:bg-cream-deep disabled:opacity-50"
              >
                <SpeakerIcon playing={audioPlaying} /> {t.listen}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showChoices && !shadowChoice && (
        <div className="grid w-full gap-2 sm:grid-cols-3">
          {p.choices.map((c, i) => (
            <ChoiceCard key={c.jp} choice={c} index={i} t={t} onSelect={() => pick(c)} />
          ))}
        </div>
      )}

      <div className="flex w-full items-center gap-3">
        {!p.typing && (
          <MicButton label={t.holdToTalk} recording={p.recording} level={p.level} busy={p.transcribing} onDown={p.onStartTalk} onUp={p.onStopTalk} />
        )}
        {p.typing ? (
          <form className="frost flex flex-1 items-center gap-2 rounded-full py-1.5 pl-5 pr-1.5"
            onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              placeholder={shadowChoice?.jp ?? t.typePlaceholder}
              className="flex-1 bg-transparent font-jp text-[17px] text-ink placeholder:text-muted/60 focus:outline-none"
            />
            <button type="submit" disabled={!text.trim()} aria-label={t.sendIt} className="transition disabled:opacity-40">
              <ArrowDot />
            </button>
          </form>
        ) : (
          <div className="frost flex flex-1 items-center rounded-full py-2.5 pl-5 pr-2">
            <span className="text-sm text-muted">{status}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

type Intent = "leave" | "ask" | "story" | "reply";

/** A rough guess at what a suggested reply does, from either language. */
function intentOf(choice: Phrase, index: number): Intent {
  const both = `${choice.jp} ${choice.en}`;
  if (/行きます|行く|行こう|向かいます|帰ります|戻ります|いきます|いこう|\b(go to|head to|going to|walk to|let'?s go)\b/i.test(both)) return "leave";
  if (index === 0) return "story";
  if (/[？?]|ですか|どこ|いくら/.test(both)) return "ask";
  return "reply";
}

const INTENT_DOT: Record<Intent, string> = { leave: "bg-ink", story: "bg-shu", ask: "bg-sky", reply: "bg-muted/50" };

function ChoiceCard({ choice, index, t, onSelect }: {
  choice: Phrase;
  index: number;
  t: Strings;
  onSelect: () => void;
}) {
  const intent = intentOf(choice, index);
  return (
    <motion.div
      className="frost group relative flex flex-col rounded-2xl px-4 py-3 text-left transition hover:bg-white/90"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index }}
      whileHover={{ y: -3 }}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${INTENT_DOT[intent]}`} />
          {t.intent[intent]}
        </span>
        <span className="grid h-5 w-5 place-items-center rounded-full bg-cream-deep">{index + 1}</span>
      </div>
      {/* A bought hint is a phrase-book page: what you'd say, how to say it, how it's written. */}
      <span className="tight mt-1.5 block text-[15px] font-medium leading-snug text-ink">“{choice.en}”</span>
      {choice.romaji && <span className="mt-0.5 block text-[15px] leading-snug text-shu">{choice.romaji}</span>}
      <span className="block font-jp text-sm leading-snug text-muted">{choice.jp}</span>
      {/* The whole card picks it. */}
      <button className="absolute inset-0 rounded-2xl" onClick={onSelect} aria-label={choice.en} />
    </motion.div>
  );
}

function SpeakerIcon({ playing }: { playing: boolean }) {
  return (
    <motion.svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"
      animate={playing ? { opacity: [1, 0.4, 1] } : { opacity: 1 }} transition={{ duration: 0.8, repeat: playing ? Infinity : 0 }}>
      <path d="M3.5 7.5h3l4-3v11l-4-3h-3z" fill="currentColor" stroke="none" />
      <path d="M13.5 7a4 4 0 0 1 0 6M15.5 5a7 7 0 0 1 0 10" />
    </motion.svg>
  );
}

function MicButton({ label, recording, level, busy, onDown, onUp }: {
  label: string; recording: boolean; level: number; busy: boolean; onDown: () => void; onUp: () => void;
}) {
  return (
    <motion.button
      aria-label={label}
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
