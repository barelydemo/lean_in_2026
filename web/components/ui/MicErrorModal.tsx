"use client";

import { AnimatePresence, motion } from "motion/react";
import { useI18n } from "@/lib/i18n";

interface Props {
  open: boolean;
  onTryAgain: () => void;
  /** Carry on without a microphone, typing replies instead. */
  onType: () => void;
  onReturnHome: () => void;
}

/** The microphone is blocked or missing: try again, type, or leave. */
export function MicErrorModal({ open, onTryAgain, onType, onReturnHome }: Props) {
  const { t } = useI18n();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center bg-ink/60 px-4 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-md rounded-[26px] bg-cream p-6 text-center text-ink shadow-2xl sm:p-8"
            initial={{ scale: 0.94, y: 16, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
          >
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-shu/10 text-shu">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3l18 18M12 15a3.5 3.5 0 0 0 3.16-2M8.5 8.5v3a3.5 3.5 0 0 0 5.95 2.47M15.5 7.5V5.5a3.5 3.5 0 1 0-7 0" />
                <path d="M18.5 11.5a6.5 6.5 0 0 1-1.22 3.8M5.5 11.5a6.5 6.5 0 0 0 5.75 6.46V21M8.75 21h6.5" />
              </svg>
            </div>
            <h2 className="tight text-2xl font-medium">{t.micTitle}</h2>
            <p className="tight mt-2 text-[15px] leading-snug text-muted">{t.micBody}</p>
            <div className="mt-6 flex flex-col gap-2">
              <motion.button whileTap={{ scale: 0.97 }} onClick={onTryAgain}
                className="w-full rounded-full bg-ink py-3 text-[15px] font-medium text-cream transition hover:bg-ink/90">
                {t.tryAgain}
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={onType}
                className="w-full rounded-full bg-cream-deep py-3 text-[15px] font-medium text-ink transition hover:bg-ink/10">
                {t.typeInstead}
              </motion.button>
              <button onClick={onReturnHome} className="mt-1 text-sm text-muted transition hover:text-ink">
                {t.backToTitle}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
