"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ExitView, Place } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { ArrowDot, PinIcon } from "./Frame";

/**
 * Where can I go from here? The player's paper map: open exits can be
 * walked to directly (or just say where you want to go); locked ones say
 * why, in the player's own words.
 */
export function MapPanel({ open, onClose, place, exits, busy, onTravel }: {
  open: boolean;
  onClose: () => void;
  place: Place;
  exits: ExitView[];
  busy: boolean;
  onTravel: (to: string) => void;
}) {
  const { t } = useI18n();
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="absolute inset-0 z-40 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="frost absolute left-1/2 top-1/2 z-50 w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl p-5 text-ink"
            initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="flex items-center gap-1.5 text-xs text-muted"><PinIcon /> {t.youAreHere}</p>
                <h2 className="tight mt-0.5 text-2xl font-medium">{place.name} <span className="font-jp text-base text-muted">{place.name_jp}</span></h2>
              </div>
              <button onClick={onClose} aria-label={t.close} className="rounded-full px-2 text-2xl text-muted hover:text-ink">×</button>
            </div>
            <p className="mt-2 text-sm text-muted">{t.whereTo}</p>
            <ul className="mt-4 space-y-2">
              {exits.length === 0 && <li className="text-sm text-muted">{t.nowhere}</li>}
              {exits.map((e, i) => (
                <motion.li key={e.to} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                  <button
                    disabled={!e.open || busy}
                    onClick={() => onTravel(e.to)}
                    className={`group flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition ${
                      e.open ? "bg-white/80 hover:bg-white" : "cursor-not-allowed bg-white/35"
                    }`}
                  >
                    <span>
                      <span className="block font-medium">
                        {e.open ? e.label : e.name}
                        {e.visited && <span className="ml-2 rounded-full bg-cream-deep px-2 py-0.5 text-[10px] font-normal text-muted">{t.beenThere}</span>}
                      </span>
                      <span className="block text-xs text-muted">
                        {e.open ? <>{e.name} <span className="font-jp">{e.name_jp}</span></> : `🔒 ${e.locked_reason}`}
                      </span>
                    </span>
                    {e.open && <span className="transition-transform group-hover:translate-x-0.5"><ArrowDot /></span>}
                  </button>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
