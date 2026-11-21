"use client";

import { AnimatePresence, motion } from "motion/react";
import { useI18n } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { audio } from "@/lib/audio/engine";
import type { Assist } from "./DialogueBox";

export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface Prefs {
  assist: Assist;
  voice: boolean;
  auto: boolean;
  speed: number;
  music: number;
  ambience: number;
  sfx: number;
  voiceVolume: number;
  difficulty: Difficulty;
}

const KEY = "lexical.prefs.v2";
const DEFAULTS: Prefs = {
  assist: "immersion", voice: true, auto: false, speed: 32,
  music: 0.55, ambience: 0.6, sfx: 0.8, voiceVolume: 1,
  difficulty: "beginner",
};

function pushVolumes(p: Prefs) {
  audio.setVolumes({ music: p.music, ambience: p.ambience, sfx: p.sfx, voice: p.voiceVolume });
}

/** Per-viewer preferences in localStorage (falls back to defaults). */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const loaded = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrefs(loaded);
      pushVolumes(loaded);
    } catch {
      pushVolumes(DEFAULTS);
    }
  }, []);
  const update = (p: Partial<Prefs>) =>
    setPrefs((old) => {
      const next = { ...old, ...p };
      pushVolumes(next);
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  return [prefs, update] as const;
}

export function SettingsPanel({ open, onClose, prefs, update, voiceAvailable, onNewGame }: {
  open: boolean;
  onClose: () => void;
  prefs: Prefs;
  update: (p: Partial<Prefs>) => void;
  voiceAvailable: boolean;
  onNewGame: () => void;
}) {
  const { t } = useI18n();
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="absolute inset-0 z-40 bg-ink/20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="frost absolute right-4 top-14 z-50 w-[min(22rem,calc(100%-2rem))] space-y-5 rounded-2xl p-5 text-ink sm:right-6"
            initial={{ opacity: 0, y: -10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.96 }}
          >
            <Group label={t.level}>
              {(["beginner", "intermediate", "advanced"] as Difficulty[]).map((v) => (
                <Pill key={v} active={prefs.difficulty === v} onClick={() => update({ difficulty: v })}>
                  {t.levels[v].label}
                </Pill>
              ))}
            </Group>
            <Group label={t.translationHelp}>
              {([["immersion", t.translatorOnly], ["full", t.alwaysTranslate]] as [Assist, string][]).map(([v, l]) => (
                <Pill key={v} active={prefs.assist === v} onClick={() => update({ assist: v })}>{l}</Pill>
              ))}
            </Group>
            <Group label={t.textSpeed}>
              {([[20, t.slow], [32, t.normal], [60, t.fast]] as [number, string][]).map(([v, l]) => (
                <Pill key={v} active={prefs.speed === v} onClick={() => update({ speed: v })}>{l}</Pill>
              ))}
            </Group>
            <Group label={t.playback}>
              <Pill active={prefs.voice && voiceAvailable} onClick={() => voiceAvailable && update({ voice: !prefs.voice })}>
                {voiceAvailable ? (prefs.voice ? t.voicesOn : t.voicesOff) : t.voicesOff}
              </Pill>
              <Pill active={prefs.auto} onClick={() => update({ auto: !prefs.auto })}>{prefs.auto ? t.auto : t.clickAdvance}</Pill>
            </Group>
            <div className="space-y-2.5">
              <p className="text-xs text-muted">{t.volume}</p>
              <Slider label={t.music} value={prefs.music} onChange={(v) => update({ music: v })} />
              <Slider label={t.ambience} value={prefs.ambience} onChange={(v) => update({ ambience: v })} />
              <Slider label={t.effects} value={prefs.sfx} onChange={(v) => { update({ sfx: v }); audio.ui("tap"); }} />
              <Slider label={t.voices} value={prefs.voiceVolume} onChange={(v) => update({ voiceVolume: v })} />
            </div>
            <button onClick={onNewGame} className="w-full rounded-full border border-hairline py-2 text-sm text-muted hover:bg-cream-deep hover:text-ink">
              {t.newGame}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-20 text-ink/80">{label}</span>
      <input
        type="range" min={0} max={1} step={0.05} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-hairline accent-shu"
      />
      <span className="w-8 text-right tabular-nums text-muted">{Math.round(value * 100)}</span>
    </label>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm transition ${active ? "bg-ink text-cream" : "bg-cream-deep text-ink/75 hover:text-ink"}`}>
      {children}
    </button>
  );
}
