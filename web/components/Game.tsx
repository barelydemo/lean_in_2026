"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, API_ORIGIN, ApiError } from "@/lib/api";
import { audio, type SfxName, type UiSound } from "@/lib/audio/engine";
import { applyLine, initialStage, isCast, replay, type StageState } from "@/lib/stage";
import { I18nProvider, makeI18n, strings } from "@/lib/i18n";
import type { CanDo, Coach, Course, DiaryEntry, DiaryLineFeedback, Gloss, GrammarPoint, InputVia, Line, Phrase, Run, RunState, Story, Translation, TravelResult, TurnResult, UnlockedSkill } from "@/lib/types";
import { NARRATOR, PLAYER } from "@/lib/types";
import { useRecorder, VoicePlayer } from "@/lib/voice";
import { Stage, type StageCues } from "./stage/Stage";
import { ArrivalCard, computeScore, FinCard, LessonCard, ScoreCard, TurnBudgetCard } from "./ui/Cards";
import type { SceneStats, TurnBudget } from "./ui/Cards";
import { CoachToast } from "./ui/CoachToast";
import { CompanionHub, type HubTab } from "./ui/CompanionHub";
import { DialogueBox } from "./ui/DialogueBox";
import { Hud } from "./ui/Hud";
import { MapPanel } from "./ui/MapPanel";
import { MicErrorModal } from "./ui/MicErrorModal";
import { ReplyDock } from "./ui/ReplyDock";
import { SettingsPanel, usePrefs } from "./ui/Settings";
import { TitleScreen } from "./ui/TitleScreen";
import { GlossCard, PhrasePanel, Translator } from "./ui/Translator";

type QueueItem =
  | { kind: "line"; line: Line }
  /** Walking into a place: the scene cuts and its name is shown. */
  | { kind: "arrival"; place: string }
  /** Prompting for turn budget when resuming a saved game in an incomplete place. */
  | { kind: "budget"; place: string }
  | { kind: "score"; stats: SceneStats }
  | { kind: "lesson"; finished: number; next: number }
  | { kind: "fin" };

const lines = (ls: Line[]): QueueItem[] => ls.map((line) => ({ kind: "line", line }));

type Mode = "playing" | "input" | "sending";

const COURSE_KEY = "lexical.course";

const NO_CUES: StageCues = { transition: null, camera: null, actor: null };

const EMOTE_SOUND: Record<string, UiSound> = {
  sparkle: "sparkle", sweat: "sweat", heart: "heart", anger: "anger", question: "question",
  exclaim: "exclaim", music: "music_note", gloom: "gloom",
};

/** The sounds a line makes as it lands on stage. */
function lineSounds(line: Line) {
  if (line.sfx && line.sfx !== "none") audio.sfx(line.sfx as SfxName);
  else if (line.transition === "flash") audio.ui("impact");
  if (line.transition === "whip") audio.sfx("whoosh");
  if (line.emote && EMOTE_SOUND[line.emote]) audio.ui(EMOTE_SOUND[line.emote]);
}

export default function Game() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [sttAvailable, setSttAvailable] = useState(false);
  const [saved, setSaved] = useState<Run | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [run, setRun] = useState<Run | null>(null);
  const [stage, setStage] = useState<StageState>(() => initialStage("narita_arrivals", "clear"));
  const [cues, setCues] = useState<StageCues>(NO_CUES);
  const [current, setCurrent] = useState<QueueItem | null>(null);
  const [shownLine, setShownLine] = useState<Line | null>(null);
  const [mode, setMode] = useState<Mode>("playing");
  const [typed, setTyped] = useState(false);
  const [voiced, setVoiced] = useState(true);
  const [backlog, setBacklog] = useState<Line[]>([]);
  const [coach, setCoach] = useState<Coach | null>(null);
  const [mastered, setMastered] = useState<Phrase[]>([]);
  const [newCandos, setNewCandos] = useState<CanDo[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);
  const [notebook, setNotebook] = useState(false);
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [hubTab, setHubTab] = useState<HubTab>("people");
  const [hubSkillNodeId, setHubSkillNodeId] = useState<string | null>(null);
  const [skillToast, setSkillToast] = useState<UnlockedSkill | null>(null);
  const [resumeHubOpen, setResumeHubOpen] = useState(false);
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([]);
  const [settings, setSettings] = useState(false);
  const [skip, setSkip] = useState(0);
  const [glosses, setGlosses] = useState<Record<number, Gloss>>({});
  /** Line whose scan is on screen; a new line closes it implicitly. */
  const [glossFor, setGlossFor] = useState<number | null>(null);
  const [deviceBusy, setDeviceBusy] = useState<"scan" | "hint" | "translate" | null>(null);
  const [phraseOpen, setPhraseOpen] = useState(false);
  const [phrase, setPhrase] = useState<Translation | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  // ── Scene scoring state ─────────────────────────────────────────────
  const [turnBudget, setTurnBudget] = useState<TurnBudget>(10);
  const [sceneTurnsUsed, setSceneTurnsUsed] = useState(0);
  const [sceneVoiceTurns, setSceneVoiceTurns] = useState(0);
  const [sceneVerdicts, setSceneVerdicts] = useState<string[]>([]);
  const [scenePronScores, setScenePronScores] = useState<number[]>([]);
  const [selectedChoice, setSelectedChoice] = useState<Phrase | null>(null);
  const [sceneFeedbacks, setSceneFeedbacks] = useState<DiaryLineFeedback[]>([]);
  const [sceneRevealCount, setSceneRevealCount] = useState(0);
  /** True while TurnBudgetCard is shown (after ArrivalCard, before the scene starts). */
  const [pickingBudget, setPickingBudget] = useState(false);

  const [prefs, updatePrefs] = usePrefs();
  const queue = useRef<QueueItem[]>([]);
  const nonce = useRef(0);
  const voice = useRef<VoicePlayer | null>(null);
  const recorder = useRecorder();

  const cast = useMemo(() => Object.fromEntries((story?.cast ?? []).map((c) => [c.id, c])), [story]);
  const items = useMemo(() => Object.fromEntries((story?.items ?? []).map((i) => [i.id, i])), [story]);
  const grammar = useMemo(() => {
    const m: Record<string, GrammarPoint> = {};
    story?.lessons.forEach((l) => l.grammar.forEach((g) => (m[g.id] = g)));
    return m;
  }, [story]);
  // Browser speech synthesis covers voices when the server has none.
  const voiceOn = prefs.voice;

  // ── boot ────────────────────────────────────────────────────────────
  useEffect(() => {
    voice.current = new VoicePlayer(false);
    // Loads the browser's voice list early (Chrome fills it asynchronously).
    if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();
    Promise.all([api.courses(), api.audioManifest()])
      .then(([c, manifest]) => {
        audio.setManifest(manifest, API_ORIGIN);
        setCourses(c.courses);
        let stored: string | null = null;
        try { stored = localStorage.getItem(COURSE_KEY); } catch {}
        setCourseId(stored && c.courses.some((x) => x.id === stored) ? stored : c.default);
      })
      .catch(() => setBootError(strings(navigator.language.startsWith("ja") ? "ja" : "en").cantReach));
    // Browsers only start audio after the first gesture.
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      voice.current?.dispose();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Load the chosen course's story and save.
  useEffect(() => {
    if (!courseId) return;
    let live = true;
    Promise.all([api.story(courseId), api.currentRun(courseId)])
      .then(([s, r]) => {
        if (!live) return;
        setStory(s.story);
        voice.current?.setServer(s.tts_enabled);
        setSttAvailable(s.stt_enabled);
        setSaved(r && r.state.status === "playing" ? r : null);
      })
      .catch(() => live && setBootError(strings("en").cantReach));
    return () => { live = false; };
  }, [courseId]);

  const chooseCourse = (id: string) => {
    if (id === courseId) return;
    try { localStorage.setItem(COURSE_KEY, id); } catch {}
    setStory(null);
    setSaved(null);
    setCourseId(id);
  };

  // The interface speaks the learner's language, which follows the course.
  const i18n = useMemo(
    () => makeI18n(story?.course.learner_lang ?? "en", story?.course.target_lang ?? "ja", story?.course.currency ?? "¥"),
    [story],
  );
  const t = i18n.t;

  // ── the beat player ────────────────────────────────────────────────
  const showLine = useCallback(
    (line: Line) => {
      const n = ++nonce.current;
      setStage((s) => applyLine(s, line));
      setCues({
        transition: line.transition && line.transition !== "none" ? { kind: line.transition, nonce: n } : null,
        camera: line.camera === "shake" || line.camera === "tilt_blur" ? { kind: line.camera, nonce: n } : null,
        actor: isCast(line.speaker)
          ? { id: line.speaker, action: line.action ?? "none", emote: line.emote ?? "none", nonce: n }
          : null,
      });
      setShownLine(line);
      setTyped(false);
      lineSounds(line);
      setBacklog((b) => (b.some((l) => l.id === line.id) ? b : [...b, line]));
      if (voiceOn && isCast(line.speaker) && line.jp && line.id > 0) {
        setVoiced(false);
        voice.current?.play(line).finally(() => setVoiced(true));
      } else {
        setVoiced(true);
      }
    },
    [voiceOn],
  );

  const next = useCallback(() => {
    voice.current?.stop();
    const item = queue.current.shift() ?? null;
    if (item?.kind === "line") audio.ui("advance");
    if (item?.kind === "arrival") audio.sfx("footsteps");
    if (item?.kind === "score") audio.ui("success");
    if (item?.kind === "lesson") audio.ui("chapter_end");
    if (item?.kind === "fin") audio.playMusic(story?.audio?.epilogue_music ?? "finale");
    setCurrent(item);
    if (!item) {
      setMode("input");
      return;
    }
    setMode("playing");
    if (item.kind === "line") showLine(item.line);
    if (item.kind === "arrival") {
      // Cut to the new place behind the title card.
      const place = story?.places.find((p) => p.id === item.place);
      if (place) {
        setStage((s) => applyLine({ ...s, actors: [] }, { id: 0, speaker: NARRATOR, scene: place.scene }));
        setCues({ transition: { kind: "fade", nonce: ++nonce.current }, camera: null, actor: null });
      }
      setShownLine(null);
      setBacklog([]);
    }
  }, [showLine, story]);

  // Score and ambience follow the scene; the title screen has its own theme.
  useEffect(() => {
    if (!story) return;
    if (!run) {
      audio.playMusic(story.audio?.title_music ?? "title");
      audio.playAmbience("curbside");
      return;
    }
    const scene = story.scenes.find((s) => s.id === stage.scene);
    if (scene) {
      audio.playMusic(scene.music ?? "morning");
      audio.playAmbience(scene.ambience ?? scene.id);
    }
  }, [story, run, stage.scene]);

  const play = useCallback(
    (items: QueueItem[]) => {
      queue.current = items;
      const ids = items.flatMap((i) => (i.kind === "line" && isCast(i.line.speaker) && i.line.jp ? [i.line.id] : []));
      if (voiceOn) voice.current?.prefetch(ids);
      next();
    },
    [next, voiceOn],
  );

  // Auto-dismiss the floating RPG Skill-Unlock Toast after 7 seconds.
  useEffect(() => {
    if (!skillToast) return;
    const timer = setTimeout(() => setSkillToast(null), 7000);
    return () => clearTimeout(timer);
  }, [skillToast]);

  // Auto mode: move on once the line is typed and voiced.
  useEffect(() => {
    if (!prefs.auto || mode !== "playing" || current?.kind !== "line" || !typed || !voiced) return;
    const t = setTimeout(next, 1400);
    return () => clearTimeout(t);
  }, [prefs.auto, mode, current, typed, voiced, next]);

  // Enter / Space finish the line, then advance (Space is push-to-talk while replying).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== "playing" || current?.kind !== "line" || notebook || diaryOpen || settings) return;
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        if (typed) next();
        else setSkip((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, current, typed, next, notebook, diaryOpen, settings]);

  // ── starting / continuing ──────────────────────────────────────────
  const enter = useCallback(
    (r: Run, fresh: boolean) => {
      if (!story) return;
      const place = story.places.find((p) => p.id === r.state.place) ?? story.places[0];
      setRun(r);
      setDiaryEntries(r.state.diary ?? []);
      setCoach(null);
      setHint(null);
      setSceneTurnsUsed(0);
      setSceneVoiceTurns(0);
      setSceneVerdicts([]);
      setScenePronScores([]);
      setSelectedChoice(null);
      setSceneFeedbacks([]);
      setSceneRevealCount(0);
      const untouched = !r.lines.some((l) => l.speaker === PLAYER);
      if (fresh || untouched) {
        setStage(initialStage(place.scene, "clear"));
        setBacklog([]);
        play([{ kind: "arrival", place: place.id }, ...lines(r.lines)]);
      } else {
        const head = r.lines.slice(0, -1);
        setStage(replay(place.scene, "clear", head));
        setBacklog(head);
        const tailItems: QueueItem[] = [];
        // When resuming a saved game, if the current place's goal is not completed,
        // prompt TurnBudgetCard before the player enters input mode.
        if (!fresh && !r.state.goal_done) {
          tailItems.push({ kind: "budget", place: place.id });
        }
        tailItems.push(...lines(r.lines.slice(-1)));
        play(tailItems);
      }
    },
    [story, play],
  );

  const newGame = async (name: string, difficulty: import("./ui/Settings").Difficulty = "beginner") => {
    setBusy(true);
    setBootError(null);
    // Persist the difficulty chosen on the onboarding screen immediately.
    updatePrefs({ difficulty });
    try {
      enter(await api.newRun(name, courseId ?? "ja"), true);
    } catch (e) {
      setBootError(e instanceof ApiError ? e.message : t.hiccup);
    } finally {
      setBusy(false);
    }
  };

  // ── a turn ─────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string, via: InputVia, pronScore?: number) => {
      if (!run || !story || mode !== "input") return;
      voice.current?.stop();
      audio.ui(via === "choice" ? "choice" : "send");
      setMode("sending");
      setHint(null);
      setCoach(null);
      const pending: Line = { id: -Date.now(), speaker: PLAYER, jp: text };
      setShownLine(pending);
      setThinking(stage.speaker && isCast(stage.speaker) ? stage.speaker : stage.actors.at(-1)?.id ?? null);

      let res: TurnResult;
      try {
        res = await api.turn(run.id, text, via, prefs.difficulty, pronScore);
      } catch (e) {
        setThinking(null);
        setMode("input");
        setShownLine(backlog.at(-1) ?? null);
        setHint(
          e instanceof ApiError && e.status === 429
            ? t.turnLimit
            : t.hiccup,
        );
        return;
      }

      setThinking(null);
      const updatedBacklog = [...backlog, res.player_line, ...res.beats];
      setBacklog((b) => [...b, res.player_line]);
      setCoach(res.coach.verdict === "none" && !res.coach.grammar_used.length && !res.candos_done?.length ? null : res.coach);
      setMastered(res.mastered ?? []);
      setNewCandos(res.candos_done ?? []);
      if (res.skill_unlocked) {
        setSkillToast({
          ...res.skill_unlocked,
          pron_score:
            res.skill_unlocked.pron_score ??
            (typeof pronScore === "number" ? Math.round(pronScore) : null),
        });
        setTimeout(() => audio.ui("sparkle"), 350);
      }
      if (res.candos_done?.length) setTimeout(() => audio.ui("grammar"), 500);
      if (res.mastered?.length) setTimeout(() => audio.ui("chapter_end"), 300);
      if (res.coach.grammar_used.length) audio.ui("grammar");
      else if (res.coach.verdict === "great" || res.coach.verdict === "good") audio.ui("success");
      else if (res.coach.verdict === "not_understood" || res.coach.verdict === "english") audio.ui("retry");
      if (res.state.yen !== run.state.yen) audio.sfx("coins");
      if (res.state.items.some((i) => !run.state.items.includes(i))) setTimeout(() => audio.ui("item"), 400);
      setRun((r) => r && {
        ...r,
        state: res.state,
        phrases: [...r.phrases, ...res.new_phrases.filter((p) => !r.phrases.some((q) => q.jp === p.jp)).map((p) => ({ ...p, lesson_idx: res.state.lesson_idx }))],
      });

      // Reaction → journal page → lesson card → walk to the next place → ending.
      const split = res.arrival_starts_at ?? res.beats.length;
      const items: QueueItem[] = lines(res.beats.slice(0, split));
      // Track this turn for the scene score; show the scorecard when the goal is
      // met or the player's chosen turn budget is used up.
      const usedAfter = sceneTurnsUsed + 1;
      const nextVoiceTurns = sceneVoiceTurns + (via === "voice" ? 1 : 0);
      const nextVerdicts = [...sceneVerdicts, res.coach.verdict];
      const nextPronScores = typeof pronScore === "number" ? [...scenePronScores, pronScore] : scenePronScores;
      const lineFb: DiaryLineFeedback = {
        line_id: res.player_line.id,
        verdict: res.coach.verdict,
        note: res.coach.note,
        better_jp: res.coach.better_jp,
        better_romaji: res.coach.better_romaji,
        better_en: res.coach.better_en,
        grammar_used: res.coach.grammar_used,
      };
      const nextFeedbacks = [...sceneFeedbacks, lineFb];
      const budgetHit = usedAfter >= turnBudget;
      setSceneTurnsUsed(usedAfter);
      setSceneVoiceTurns(nextVoiceTurns);
      setSceneVerdicts(nextVerdicts);
      setScenePronScores(nextPronScores);
      setSceneFeedbacks(nextFeedbacks);

      if (res.goal_complete || budgetHit) {
        const scenePlace = story.places.find((p) => p.id === run.state.place);
        const stats: SceneStats = {
          totalTurns: usedAfter,
          voiceTurns: nextVoiceTurns,
          verdicts: nextVerdicts,
          pronunciationScores: nextPronScores,
          revealCount: sceneRevealCount,
          goalReached: !!res.goal_complete,
          placeId: scenePlace?.id ?? run.state.place,
          placeName: scenePlace?.name ?? "",
          placeNameJp: scenePlace?.name_jp ?? "",
          journal: res.goal_complete?.journal,
          difficulty: prefs.difficulty,
        };
        const { rank, scores, total } = computeScore(stats);
        const rewardBat = rank === "S" ? 30 : rank === "A" ? 20 : rank === "B" ? 10 : 0;
        const rewardTrust = rank === "S" ? (scenePlace?.cast ?? []) : [];
        stats.rewardBattery = rewardBat;
        stats.rewardTrust = rewardTrust;

        // Optimistically add to local diary and persist on server (grants battery & trust rewards).
        const localEntry: DiaryEntry = {
          id: `local-${Date.now()}`,
          place_id: scenePlace?.id ?? run.state.place,
          place_name: scenePlace?.name ?? "",
          place_name_jp: scenePlace?.name_jp ?? "",
          rank,
          score: total,
          turns_used: usedAfter,
          voice_turns: nextVoiceTurns,
          difficulty: prefs.difficulty,
          metrics: scores,
          lines: updatedBacklog.slice(0, backlog.length + 1 + split),
          feedbacks: nextFeedbacks,
          journal: res.goal_complete?.journal ?? null,
          reward_battery: rewardBat,
          reward_trust: rewardTrust,
          created_at: Math.floor(Date.now() / 1000),
        };
        setDiaryEntries((prev) => [...prev, localEntry]);

        api
          .recordScore(run.id, {
            place_id: localEntry.place_id,
            place_name: localEntry.place_name,
            place_name_jp: localEntry.place_name_jp,
            rank,
            score: total,
            turns_used: usedAfter,
            voice_turns: nextVoiceTurns,
            difficulty: prefs.difficulty,
            metrics: scores,
            feedbacks: nextFeedbacks,
            journal: res.goal_complete?.journal,
          })
          .then((scoreRes) => {
            setRun((old) => old && { ...old, state: scoreRes.state, scene_scores: scoreRes.scene_scores });
            if (scoreRes.state.diary?.length) {
              setDiaryEntries(scoreRes.state.diary);
            }
          })
          .catch(() => {});

        items.push({ kind: "score", stats });
        // A fresh budget starts for whatever the player does next.
        setSceneTurnsUsed(0);
        setSceneVoiceTurns(0);
        setSceneVerdicts([]);
        setSceneFeedbacks([]);
        setSceneRevealCount(0);
      }
      if (res.lesson_complete) items.push({ kind: "lesson", ...res.lesson_complete });
      if (res.moved_to) items.push({ kind: "arrival", place: res.moved_to });
      items.push(...lines(res.beats.slice(split)));
      if (res.ending) items.push({ kind: "fin" });
      play(items);
      if (res.goal_complete || res.lesson_complete) {
        // Pick up the journal entry and the next lesson's vocabulary.
        api.currentRun(run.state.course).then((r) => r && setRun((old) => old && { ...old, phrases: r.phrases, journal: r.journal })).catch(() => {});
      }
    },
    [run, story, mode, stage, backlog, play, t, sceneTurnsUsed, sceneVoiceTurns, sceneVerdicts, sceneFeedbacks, sceneRevealCount, turnBudget, prefs.difficulty],
  );

  // Ask for the microphone as soon as the player can first reply, so the
  // permission prompt doesn't swallow the first push-to-talk.
  const micAsked = useRef(false);
  useEffect(() => {
    if (mode === "input" && sttAvailable && !micAsked.current) {
      micAsked.current = true;
      void recorder.prepare();
    }
  }, [mode, sttAvailable, recorder]);

  // ── walking somewhere from the map ─────────────────────────────────
  const travel = useCallback(
    async (to: string, force = false) => {
      if (!run || (!force && mode !== "input") || mode === "sending") return;
      setMapOpen(false);
      setDiaryOpen(false);
      voice.current?.stop();
      setMode("sending");
      let res: TravelResult;
      try {
        res = await api.travel(run.id, to, prefs.difficulty);
      } catch (e) {
        setMode("input");
        setHint(e instanceof ApiError ? e.message : t.lostTheWay);
        return;
      }
      setRun((r) => r && { ...r, state: res.state });
      play([
        ...lines(res.beats.slice(0, res.arrival_starts_at)),
        { kind: "arrival", place: res.state.place },
        ...lines(res.beats.slice(res.arrival_starts_at)),
      ]);
    },
    [run, mode, play, t, prefs.difficulty],
  );

  const advanceAfterScore = useCallback(() => {
    setDiaryOpen(false);
    // If the turn that ended the scene already queued an arrival or ending, play it.
    if (queue.current.some((item) => item.kind === "arrival" || item.kind === "fin")) {
      next();
      return;
    }
    // Otherwise, move to the next open scene exit (preferring unvisited places).
    const exits = (run?.state.exits ?? []).filter((e) => e.open);
    const visitedIds = new Set(diaryEntries.map((d) => d.place_id));
    const nextExit = exits.find((e) => !visitedIds.has(e.to)) ?? exits[0];
    if (nextExit) {
      queue.current = [];
      setCurrent(null);
      void travel(nextExit.to, true);
    } else {
      next();
    }
  }, [run?.state.exits, diaryEntries, next, travel]);

  // ── the translator device ──────────────────────────────────────────
  const updateState = (state: RunState) => setRun((r) => r && { ...r, state });

  // The most recent thing someone said to the player.
  const scanTarget = shownLine && shownLine.id > 0 && shownLine.jp && shownLine.speaker !== PLAYER && shownLine.speaker !== NARRATOR
    ? shownLine
    : null;

  const scan = useCallback(async () => {
    if (!run || !scanTarget || deviceBusy) return;
    if (glosses[scanTarget.id]) {
      setGlossFor(scanTarget.id);
      return;
    }
    setDeviceBusy("scan");
    audio.ui("send");
    try {
      const res = await api.scan(run.id, scanTarget.id);
      setGlosses((g) => ({ ...g, [res.line_id]: res.gloss }));
      setGlossFor(res.line_id);
      updateState(res.state);
      audio.ui("sparkle");
    } catch (e) {
      setHint(e instanceof ApiError && e.status === 409 ? t.batteryDead : t.glitched);
      audio.ui("retry");
    } finally {
      setDeviceBusy(null);
    }
  }, [run, scanTarget, deviceBusy, glosses, t]);

  // After the arrival title card, ask the player for this scene's turn budget.
  const arrivalDone = useCallback(() => setPickingBudget(true), []);

  const unlockHint = useCallback(async () => {
    if (!run || deviceBusy || run.state.choices_unlocked) return;
    setDeviceBusy("hint");
    try {
      const res = await api.hint(run.id);
      updateState(res.state);
      audio.ui("choice");
      // Buying suggestions with battery counts as a hint for scoring (Beginner gets them free).
      if (prefs.difficulty !== "beginner") setSceneRevealCount((n) => n + 1);
    } catch (e) {
      setHint(e instanceof ApiError && e.status === 409 ? t.batteryDead : t.glitched);
    } finally {
      setDeviceBusy(null);
    }
  }, [run, deviceBusy, t, prefs.difficulty]);

  // Auto-unlock hints in Beginner mode so choices always appear for free.
  useEffect(() => {
    if (prefs.difficulty !== "beginner" || !run || mode !== "input" || run.state.choices_unlocked || deviceBusy) return;
    unlockHint();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, run?.id, prefs.difficulty]);

  // "How do I say…?" — English in, a Japanese line to read aloud out.
  const translate = useCallback(async (english: string) => {
    if (!run || deviceBusy) return;
    setDeviceBusy("translate");
    audio.ui("send");
    try {
      const res = await api.translate(run.id, english);
      setPhrase(res.translation);
      updateState(res.state);
      audio.ui("sparkle");
    } catch (e) {
      setHint(e instanceof ApiError && e.status === 409 ? t.batteryDead : t.glitched);
      audio.ui("retry");
    } finally {
      setDeviceBusy(null);
    }
  }, [run, deviceBusy, t]);

  const togglePhrase = useCallback(() => {
    setPhraseOpen((o) => !o);
    setPhrase(null);
  }, []);

  const replayVoice = useCallback(() => {
    if (!scanTarget) return;
    setVoiced(false);
    voice.current?.play(scanTarget).finally(() => setVoiced(true));
  }, [scanTarget]);

  const previewChoiceVoice = useCallback(
    async (text: string) => {
      if (!voice.current) return;
      const activePlace = story?.places.find((p) => p.id === run?.state.place);
      const speakerId =
        (stage.speaker && isCast(stage.speaker) ? stage.speaker : null) ??
        stage.actors.at(-1)?.id ??
        activePlace?.cast[0] ??
        "aiko";
      await voice.current.preview(text, speakerId, run?.state.course ?? courseId ?? "ja");
    },
    [story, run?.state.place, run?.state.course, stage.speaker, stage.actors, courseId],
  );

  // S / H / R drive the device (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || notebook || diaryOpen || settings) return;
      const k = e.key.toLowerCase();
      if (k === "s") scan();
      else if (k === "h" && mode === "input") unlockHint();
      else if (k === "r") replayVoice();
      else if (k === "m") setMapOpen((o) => !o);
      else if (k === "t") { e.preventDefault(); togglePhrase(); }
      else if (k === "escape") { setMapOpen(false); setPhraseOpen(false); setDiaryOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scan, unlockHint, replayVoice, togglePhrase, mode, notebook, diaryOpen, settings]);

  const startTalk = useCallback(() => {
    if (mode !== "input" || transcribing) return;
    setMicNote(null);
    voice.current?.stop();
    audio.ui("mic_on");
    recorder.start();
  }, [mode, transcribing, recorder]);

  const stopTalk = useCallback(async () => {
    const blob = await recorder.stop();
    audio.ui("mic_off");
    if (!blob) {
      setMicNote(t.holdWhileSpeaking);
      return;
    }
    setTranscribing(true);
    try {
      let reference: string | undefined;
      if (!phraseOpen && prefs.difficulty !== "advanced") {
        if (selectedChoice?.jp) {
          reference = selectedChoice.jp;
        } else if (run?.state.choices?.length) {
          reference = run.state.choices.map((c) => c.jp).join("||");
        }
      }
      const { text, pronunciation } = await api.stt(blob, reference);
      // While the phrase panel is open, speech goes to the dictionary instead.
      if (text.trim() && phraseOpen) translate(text);
      else if (text.trim()) send(text, "voice", pronunciation?.overall);
      else setMicNote(t.didntCatch);
    } catch {
      setMicNote(t.couldntHear);
    } finally {
      setTranscribing(false);
    }
  }, [recorder, send, phraseOpen, translate, t, prefs.difficulty, selectedChoice, run?.state.choices]);

  // ── render ─────────────────────────────────────────────────────────
  if (!story || !run) {
    return (
      <I18nProvider value={i18n}>
      <main className="h-dvh w-full bg-cream">
        {story ? (
          <>
            <TitleScreen story={story} courses={courses} courseId={courseId ?? story.course.id} onCourse={chooseCourse}
              canContinue={!!saved} busy={busy} error={bootError}
              onContinue={() => {
                if (!saved) return;
                audio.ui("open");
                setHubTab("people");
                setResumeHubOpen(true);
              }}
              onNew={newGame} />
            {saved && (
              <CompanionHub
                open={resumeHubOpen}
                initialTab={hubTab}
                mode="resume"
                story={story}
                run={saved}
                entries={saved.state.diary ?? []}
                backlog={saved.lines}
                cast={cast}
                grammar={grammar}
                onClose={() => {
                  audio.ui("close");
                  setResumeHubOpen(false);
                }}
                onEnterScene={() => {
                  audio.ui("choice");
                  setResumeHubOpen(false);
                  enter(saved, false);
                }}
                onReplayLine={(l) => {
                  if (l.jp && isCast(l.speaker)) {
                    if (l.id > 0) void voice.current?.play(l);
                    else void voice.current?.preview(l.jp, l.speaker, saved.state.course);
                  }
                }}
                onPreviewVoice={(text, speakerId) => {
                  void voice.current?.preview(text, speakerId ?? "aiko", saved.state.course);
                }}
              />
            )}
          </>
        ) : (
          <div className="grid h-full place-items-center text-paper/60">
            {bootError ?? (
              <motion.span className="font-jp text-4xl text-ink" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.6, repeat: Infinity }}>
                迷子の日本
              </motion.span>
            )}
          </div>
        )}
      </main>
      </I18nProvider>
    );
  }

  const place = story.places.find((p) => p.id === run.state.place) ?? story.places[0];
  const lesson = story.lessons[run.state.lesson_idx] ?? story.lessons[0];
  const quest = story.quests.find((q) => q.id === run.state.quest);
  const speaker = shownLine?.speaker ?? NARRATOR;
  const member = cast[speaker];
  const lineName = speaker === PLAYER ? run.state.player_name : member?.name.split(" ").slice(-1)[0] ?? shownLine?.speaker_name ?? "";
  const lineColor = speaker === PLAYER ? "#fdfcf3" : member?.color ?? "#9aa3ad";
  const card = current && current.kind !== "line" ? current : null;

  return (
    <I18nProvider value={i18n}>
    <main className="h-dvh w-full select-none bg-cream p-2 sm:p-3.5">
      <div className="relative h-full w-full overflow-hidden rounded-[26px] bg-ink">
        <div className="absolute inset-0" onClick={() => mode === "playing" && current?.kind === "line" && typed && next()}>
          <Stage stage={stage} cues={cues} cast={cast} thinking={thinking} />
        </div>

        <Hud place={place} lesson={lesson} quest={quest} state={run.state} items={items}
          diaryCount={diaryEntries.length}
          onMap={() => { audio.ui("open"); setMapOpen(true); }}
          onOpenHub={(tab) => { audio.ui("open"); setHubSkillNodeId(null); setHubTab(tab); setDiaryOpen(true); }}
          onDiary={() => { audio.ui("open"); setHubSkillNodeId(null); setHubTab("diary"); setDiaryOpen(true); }}
          onNotebook={() => { audio.ui("open"); setHubSkillNodeId(null); setHubTab("people"); setDiaryOpen(true); }}
          onSettings={() => { audio.ui("tap"); setSettings(true); }} />
        <CoachToast coach={coach} mastered={mastered} candos={newCandos} grammar={grammar} onClose={() => { setCoach(null); setMastered([]); setNewCandos([]); }} />
        <AnimatePresence>
          {skillToast && (
            <motion.div
              key={`${skillToast.node_id}-${skillToast.mastery_level}`}
              className="pointer-events-auto absolute left-1/2 top-16 z-30 flex -translate-x-1/2 cursor-pointer items-center gap-3 rounded-full border border-emerald-400/90 bg-gradient-to-r from-emerald-950/95 via-ink/95 to-emerald-900/95 px-5 py-2.5 text-cream shadow-2xl ring-2 ring-emerald-400/30 sm:top-[4.5rem]"
              initial={{ y: -28, opacity: 0, scale: 0.92 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -28, opacity: 0, scale: 0.92 }}
              transition={{ type: "spring", stiffness: 240, damping: 22 }}
              onClick={() => {
                const nodeId = skillToast.node_id;
                setSkillToast(null);
                audio.ui("open");
                setHubTab("progress");
                setHubSkillNodeId(nodeId);
                setDiaryOpen(true);
              }}
            >
              <span className="text-lg">✨</span>
              <p className="text-xs font-semibold sm:text-sm">
                <span className="text-emerald-300">
                  {skillToast.mastery_level > 1
                    ? `Skill Lv.${skillToast.mastery_level}:`
                    : "Skill Unlocked:"}
                </span>{" "}
                <span>
                  {skillToast.icon} {skillToast.title} (
                  <span className="font-jp">{skillToast.title_jp}</span>)
                </span>
                {skillToast.pron_score != null && (
                  <span className="ml-1.5 rounded-full bg-emerald-500/25 px-2 py-0.5 text-emerald-200">
                    · {skillToast.pron_score}% Accuracy!
                  </span>
                )}
              </p>
              <span className="hidden text-[11px] text-emerald-300/80 sm:inline">
                Inspect →
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        {story.device && (
          <Translator
            device={story.device}
            battery={run.state.battery}
            canScan={!!scanTarget && (run.state.battery >= story.device.scan_cost || !!glosses[scanTarget.id])}
            canHint={mode === "input" && run.state.battery >= story.device.hint_cost}
            hintUnlocked={run.state.choices_unlocked}
            phraseOpen={phraseOpen}
            onPhrase={togglePhrase}
            wordsKnown={Object.values(run.state.known_words).filter((w) => w.kind !== "particle").length}
            wordsMastered={Object.values(run.state.known_words).filter((w) => w.mastered).length}
            busy={deviceBusy}
            onScan={scan}
            onHint={unlockHint}
            onReplay={scanTarget ? replayVoice : null}
          />
        )}

        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 pb-4 sm:pb-12">
          <AnimatePresence>
            {phraseOpen && (
              <PhrasePanel
                key="phrase"
                result={phrase}
                busy={deviceBusy === "translate"}
                recording={recorder.recording}
                transcribing={transcribing}
                level={recorder.level}
                cost={story.device.translate_cost}
                battery={run.state.battery}
                grammar={grammar}
                onStartTalk={startTalk}
                onStopTalk={stopTalk}
                onSay={(jp) => { setPhraseOpen(false); setPhrase(null); send(jp, "choice"); }}
                onClose={() => { setPhraseOpen(false); setPhrase(null); }}
              />
            )}
          </AnimatePresence>
          {scanTarget && glossFor === scanTarget.id && glosses[scanTarget.id] && (
            <GlossCard gloss={glosses[scanTarget.id]} grammar={grammar} onClose={() => setGlossFor(null)} />
          )}
          {shownLine && (
            <DialogueBox
              known={run.state.known_words}
              seen={run.state.seen_words}
              line={shownLine}
              name={lineName}
              nameJp={member?.name_jp}
              color={lineColor}
              assist={prefs.difficulty === "beginner" ? "full" : prefs.assist}
              charsPerSecond={prefs.speed}
              skip={skip}
              speaking={!voiced}
              onTick={() => voiced && audio.ui("type")}
              onTyped={() => setTyped(true)}
              onAdvance={next}
              canAdvance={mode === "playing"}
              dimmed={mode === "input"}
            />
          )}
          <AnimatePresence>
            {mode === "input" && (
              <ReplyDock
                key="dock"
                choices={run.state.choices}
                assist={prefs.assist}
                difficulty={prefs.difficulty}
                voiceEnabled={sttAvailable}
                recording={recorder.recording}
                level={recorder.level}
                transcribing={transcribing}
                micError={recorder.error ? t.micBlocked : micNote}
                hint={hint}
                hintCost={story.device.hint_cost}
                battery={run.state.battery}
                onUnlockHint={unlockHint}
                exits={run.state.exits ?? []}
                onTravel={travel}
                onStartTalk={startTalk}
                onStopTalk={stopTalk}
                onSend={send}
                onReveal={() => setSceneRevealCount((n) => n + 1)}
                onPreviewVoice={previewChoiceVoice}
                onSelectChoice={setSelectedChoice}
              />
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {card?.kind === "arrival" && !pickingBudget && (
            <ArrivalCard key={`a${card.place}`} place={story.places.find((p) => p.id === card.place) ?? place} onDone={arrivalDone} />
          )}
          {((card?.kind === "arrival" && pickingBudget) || card?.kind === "budget") && (
            <TurnBudgetCard key={`b${card.place}`} place={story.places.find((p) => p.id === card.place) ?? place}
              onDone={(b) => {
                setTurnBudget(b);
                setSceneTurnsUsed(0); setSceneVoiceTurns(0); setSceneVerdicts([]); setScenePronScores([]); setSelectedChoice(null); setSceneFeedbacks([]); setSceneRevealCount(0);
                setPickingBudget(false);
                next();
              }} />
          )}
          {card?.kind === "score" && (
            <ScoreCard
              key={`s${card.stats.totalTurns}${card.stats.placeName}`}
              stats={card.stats}
              onDone={advanceAfterScore}
              onStayAndDiary={() => {
                audio.ui("open");
                setHubTab("diary");
                setDiaryOpen(true);
              }}
            />
          )}
          {card?.kind === "lesson" && (
            <LessonCard key={`l${card.finished}`} finished={story.lessons[card.finished]} next={story.lessons[card.next]}
              learned={story.lessons[card.finished].grammar.filter((g) => (run.state.grammar_counts[g.id] ?? 0) > 0)} onDone={next} />
          )}
          {card?.kind === "fin" && (
            <FinCard key="fin" name={run.state.player_name} onDone={() => { setRun(null); setSaved(null); }} />
          )}
        </AnimatePresence>

        <MapPanel open={mapOpen} onClose={() => setMapOpen(false)} place={place} exits={run.state.exits ?? []}
          busy={mode !== "input"} onTravel={travel} />
        <CompanionHub
          open={diaryOpen || notebook}
          initialTab={hubTab}
          initialSkillNodeId={hubSkillNodeId}
          mode={card?.kind === "score" ? "scorecard" : "ingame"}
          story={story}
          run={run}
          entries={diaryEntries}
          backlog={backlog}
          cast={cast}
          grammar={grammar}
          onClose={() => {
            audio.ui("close");
            setDiaryOpen(false);
            setNotebook(false);
            setHubSkillNodeId(null);
          }}
          onNextScene={advanceAfterScore}
          onTravel={(to) => {
            setNotebook(false);
            setDiaryOpen(false);
            setHubSkillNodeId(null);
            void travel(to, true);
          }}
          onReplayLine={(l) => {
            if (l.jp && isCast(l.speaker)) {
              if (l.id > 0) void voice.current?.play(l);
              else void voice.current?.preview(l.jp, l.speaker, run.state.course);
            }
          }}
          onPreviewVoice={(text, speakerId) => {
            void voice.current?.preview(text, speakerId ?? "aiko", run.state.course);
          }}
        />
        <SettingsPanel open={settings} onClose={() => setSettings(false)} prefs={prefs} update={updatePrefs}
          voiceAvailable
          onNewGame={() => { setSettings(false); voice.current?.stop(); setRun(null); setSaved(null); }} />
        <MicErrorModal
          open={!!recorder.error || !sttAvailable}
          onTryAgain={() => {
            recorder.clearError();
            void recorder.prepare();
          }}
          onReturnHome={() => {
            recorder.clearError();
            voice.current?.stop();
            setRun(null);
          }}
        />
      </div>
    </main>
    </I18nProvider>
  );
}
