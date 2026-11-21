"use client";

import { AnimatePresence, motion } from "motion/react";

interface Props {
  open: boolean;
  onTryAgain: () => void;
  onReturnHome: () => void;
}

export function MicErrorModal({ open, onTryAgain, onReturnHome }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center bg-ink/70 px-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-md rounded-3xl bg-cream p-6 text-center text-ink shadow-2xl sm:p-8"
            initial={{ scale: 0.92, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
          >
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-shu/10 text-shu">
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M12 15a3.5 3.5 0 0 0 3.16-2M8.5 8.5v3a3.5 3.5 0 0 0 5.95 2.47M15.5 7.5V5.5a3.5 3.5 0 1 0-7 0" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 11.5a6.5 6.5 0 0 1-1.22 3.8M5.5 11.5a6.5 6.5 0 0 0 5.75 6.46V21M8.75 21h6.5" />
              </svg>
            </div>

            <h2 className="tight text-2xl font-medium text-ink sm:text-3xl">
              Microphone Not Available
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Lexical is a voice-first experience and requires microphone access to hear your Japanese.
            </p>

            <div className="mt-7 flex flex-col gap-2.5">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={onTryAgain}
                className="w-full rounded-full bg-ink py-3 text-[15px] font-medium text-cream transition hover:bg-ink/90"
              >
                Try Again
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={onReturnHome}
                className="w-full rounded-full border border-hairline bg-cream-deep py-3 text-[15px] font-medium text-ink/80 transition hover:bg-ink/10 hover:text-ink"
              >
                Return to Home Screen
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
