"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import type { CanDo, Coach, GrammarPoint, Phrase } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

const DOT: Record<string, string> = {
  great: "#2fa35a", good: "#2fa35a", understood: "#3d7fe0", not_understood: "#e08a3d", english: "#c8202f", none: "#3d7fe0",
};

/** The big exclamation, in the language being learned. */
const EXCLAIM: Record<string, Record<string, string>> = {
  ja: { great: "すごい！", good: "いいね！", understood: "つうじた！", not_understood: "もういちど", english: "にほんごで！", none: "できた！" },
  en: { great: "Perfect!", good: "Nice!", understood: "Got it!", not_understood: "One more time", english: "In English!", none: "You did it!" },
};

export function CoachToast({ coach, mastered, candos, grammar, onClose }: {
  coach: Coach | null;
  /** Words the player just used for the first time. */
  mastered: Phrase[];
  /** Can-dos this turn ticked off. */
  candos: CanDo[];
  grammar: Record<string, GrammarPoint>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!coach) return;
    const t = setTimeout(onClose, 9000);
    return () => clearTimeout(t);
  }, [coach, onClose]);

  const { t, target } = useI18n();
  const v = coach
    ? {
        jp: (EXCLAIM[target] ?? EXCLAIM.ja)[coach.verdict] ?? "",
        en: (t.verdict as Record<string, string>)[coach.verdict] ?? "",
        dot: DOT[coach.verdict] ?? DOT.none,
      }
    : null;

  return (
    <AnimatePresence>
      {coach && v && (
        <motion.div
          className="frost pointer-events-auto absolute right-4 top-16 z-30 w-[min(21rem,calc(100%-2rem))] rounded-2xl p-4 text-ink sm:right-6 sm:top-[4.5rem]"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 190, damping: 22 }}
          onClick={onClose}
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 rounded-full bg-cream-deep px-2.5 py-0.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: v.dot }} />
              {t.senseiNote}
            </span>
            <span className="text-xs text-muted">{v.en}</span>
          </div>
          <motion.p className="mt-2 font-jp text-2xl font-bold"
            initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>{v.jp}</motion.p>
          {coach.note && <p className="tight mt-0.5 text-[15px] leading-snug text-ink/85">{coach.note}</p>}
          {coach.better_jp && (
            <div className="mt-3 border-t border-hairline pt-2.5">
              <p className="text-[11px] uppercase tracking-wider text-muted">{t.moreNatural}</p>
              <p className="font-jp text-lg">{coach.better_jp}</p>
              <p className="text-xs text-muted">{coach.better_romaji}</p>
              {coach.better_en && <p className="tight text-sm text-ink/70">{coach.better_en}</p>}
            </div>
          )}
          {mastered.length > 0 && (
            <div className="mt-3 rounded-2xl bg-ink px-3 py-2 text-cream">
              <p className="text-[11px] uppercase tracking-wider text-cream/60">{t.wordOwned}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {mastered.map((m) => (
                  <motion.span key={m.jp} className="font-jp text-base"
                    initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", delay: 0.3 }}>
                    {m.jp} <span className="font-sans text-xs text-cream/60">{m.en}</span>
                  </motion.span>
                ))}
              </div>
            </div>
          )}
          {candos.length > 0 && (
            <div className="mt-3 rounded-2xl border border-shu/30 bg-shu/5 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-shu">{t.canDoUnlocked}</p>
              {candos.map((c) => (
                <motion.p key={c.id} className="tight mt-0.5 text-[15px] font-medium"
                  initial={{ x: -8, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.25 }}>
                  ✓ {c.text}
                </motion.p>
              ))}
            </div>
          )}
          {coach.grammar_used.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {coach.grammar_used.map((id) => (
                <motion.span key={id} className="rounded-full bg-shu px-2.5 py-0.5 font-jp text-xs font-medium text-white"
                  initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.2 }}>
                  ✓ {grammar[id]?.pattern ?? id}
                </motion.span>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
