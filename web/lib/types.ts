// Mirrors the Rust server's JSON. Cue names must match server/src/story.rs.

export type Expression =
  | "neutral" | "happy" | "worried" | "surprised" | "thinking" | "annoyed" | "embarrassed" | "sad";
export type Transition = "none" | "fade" | "crossfade" | "flash" | "blackout" | "wake" | "whip";
export type Camera = "none" | "shake" | "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "tilt_blur";
export type Action =
  | "none" | "enter_left" | "enter_right" | "exit_left" | "exit_right" | "hop" | "nod"
  | "shake_head" | "tremble" | "lean_in" | "bow" | "turn_away" | "point_left" | "point_right" | "point"
  | "hand" | "wave";
export type Emote =
  | "none" | "sparkle" | "sweat" | "heart" | "anger" | "question" | "exclaim" | "blush" | "music" | "gloom";
export type Ambient = "keep" | "clear" | "rain" | "snow" | "petals" | "night_bokeh" | "dust";
export type Sfx =
  | "none" | "door_chime" | "train_doors" | "radio" | "phone" | "stamp" | "coins"
  | "footsteps" | "thud" | "whoosh" | "bell";
export type Verdict = "none" | "great" | "good" | "understood" | "not_understood" | "english";

/** One line of the visual novel plus its stage cues. Omitted cues are defaults. */
export interface Line {
  id: number;
  speaker: string; // cast id | "narrator" | "thought" | "extra" | "you"
  speaker_name?: string;
  expression?: Expression;
  jp?: string;
  romaji?: string;
  en?: string;
  scene?: string;
  transition?: Transition;
  camera?: Camera;
  action?: Action;
  emote?: Emote;
  ambient?: Ambient;
  sfx?: Sfx;
  /** People who quietly come into view with this line, not talking yet. */
  enter?: string[];
}

export interface Phrase {
  jp: string;
  romaji: string;
  en: string;
}

export interface CastMember {
  id: string;
  name: string;
  name_jp: string;
  role: string;
  sprite: string;
  color: string;
  /** Turns of patience in a scene before they have to go. */
  patience: number;
  /** Extra art in /characters/<id>/<pose>.png: expressions, "talk", gestures. */
  poses: string[];
  /** "counter": waist-up art behind a counter, kept whole and centred. */
  stance?: "standing" | "counter";
  /** A side character (hostel owner, shopkeeper), not part of the main cast. */
  minor?: boolean;
  /** A generic passer-by, cast by the game for unnamed speakers. */
  townsfolk?: boolean;
}

/** Something in a scene that won't wait (a departing train). */
export interface SceneTimer {
  turns: number;
  label: string;
}

export interface Device {
  name: string;
  name_jp: string;
  start_battery: number;
  scan_cost: number;
  hint_cost: number;
  translate_cost: number;
}

/** The dictionary's answer to "how do I say…?". */
export interface Translation {
  jp: string;
  romaji: string;
  en: string;
  words: GlossWord[];
}

export type WordKind =
  | "noun" | "verb" | "adjective" | "adverb" | "particle" | "copula" | "question"
  | "expression" | "name" | "number" | "other";

export interface GlossWord {
  jp: string;
  romaji: string;
  en: string;
  kind: WordKind;
  note: string;
  grammar_id: string;
}

/** A dictionary breakdown — deliberately no sentence translation. */
export interface Gloss {
  words: GlossWord[];
}

export interface KnownWord {
  romaji: string;
  en: string;
  kind: string;
  note: string;
  /** Owned: used on several separate occasions. */
  mastered: boolean;
  uses: number;
}

export interface SceneInfo {
  id: string;
  name: string;
  name_jp: string;
  music?: string;
  ambience?: string;
  /** Another time of day of this scene id. */
  variant_of?: string;
  clock?: string;
}

export interface Item {
  id: string;
  name: string;
  name_jp: string;
  icon: string;
}

export interface GrammarPoint {
  id: string;
  pattern: string;
  meaning: string;
  example_jp: string;
  example_romaji: string;
  example_en: string;
}

/** A course: a target language taught to speakers of a learner language. */
export interface Course {
  id: string;
  target_lang: string;
  learner_lang: string;
  target_name: string;
  learner_name: string;
  reading: string;
  label: string;
  tagline: string;
  currency: string;
  locked_lesson: string;
  locked_unknown: string;
  landing: Landing;
}

/** A course's title screen, in the learner's language. */
export interface Landing {
  title: string;
  body: string;
  scene: string;
  place: string;
  clock: string;
  character: string;
  lines: Phrase[];
  feature_scenes: string[];
}

/** "I can…": a goal ticked off when the player actually does it. */
export interface CanDo {
  id: string;
  text: string;
  example: string;
  example_reading: string;
}

export interface Lesson {
  index: number;
  title: string;
  title_jp: string;
  topic: string;
  min_grammar: number;
  min_turns: number;
  grammar: GrammarPoint[];
  vocab: Phrase[];
  candos: CanDo[];
}

export interface Place {
  id: string;
  name: string;
  name_jp: string;
  scene: string;
  clock: string;
  cast: string[];
  /** Situational context and atmosphere for this place. */
  situation?: string;
  /** The player's own thought about what to do here. */
  goal: string;
  /** Key words this place teaches. */
  pack: Phrase[];
  candos: string[];
  timer?: SceneTimer | null;
}

/** A step of the big arc, as the player's own thought. */
export interface Quest {
  id: string;
  title: string;
  title_jp: string;
  flags_any: string[];
}

/** An exit from the current place, as the server sees it. */
export interface ExitView {
  to: string;
  name: string;
  name_jp: string;
  label: string;
  open: boolean;
  locked_reason: string | null;
  visited: boolean;
}

export interface Story {
  course: Course;
  title: string;
  title_jp: string;
  start_place: string;
  cast: CastMember[];
  items: Item[];
  scenes: SceneInfo[];
  lessons: Lesson[];
  quests: Quest[];
  places: Place[];
  /** Optional so an older server without audio support doesn't break the client. */
  audio?: { title_music: string; epilogue_music: string };
  device: Device;
}

export interface DiaryLineFeedback {
  line_id: number;
  verdict: Verdict;
  note: string;
  better_jp: string;
  better_romaji: string;
  better_en: string;
  grammar_used?: string[];
}

export interface DiaryEntry {
  id: string;
  place_id: string;
  place_name: string;
  place_name_jp: string;
  rank: "S" | "A" | "B" | "C" | string;
  score: number;
  turns_used: number;
  voice_turns: number;
  difficulty: string;
  metrics: Record<string, number>;
  /** Server stores (id, Beat) tuples or Line objects */
  lines: ([number, Omit<Line, "id">] | Line)[];
  feedbacks: DiaryLineFeedback[];
  journal?: string | null;
  reward_battery: number;
  reward_trust: string[];
  created_at: number;
}

export interface SceneScoreRow {
  id: number;
  run_id: string;
  place_id: string;
  rank: string;
  score: number;
  turns_used: number;
  created_at: number;
}

export interface PhonemeScore {
  phoneme: string;
  accuracy: number;
}

export interface PronunciationAssessment {
  accuracy: number;
  fluency: number;
  completeness: number;
  overall: number;
  phonemes: PhonemeScore[];
  provider: string;
}

export interface UnlockedSkill {
  node_id: string;
  /** "lesson": one node per lesson of the course. */
  branch: string;
  title: string;
  title_jp: string;
  icon: string;
  sentence: string;
  pron_score?: number | null;
  verdict: Verdict | string;
  place_id: string;
  place_name: string;
  timestamp: number;
  mastery_level: number;
  uses: number;
  segments_used?: number[];
}

export interface RunState {
  course: string;
  status: "playing" | "complete";
  player_name: string;
  place: string;
  exits: ExitView[];
  /** Id of the current big-arc quest, or null when the story is over. */
  quest: string | null;
  goal_done: boolean;
  goals_done: string[];
  visited?: string[];
  flags: string[];
  lesson_idx: number;
  lesson_turns: number;
  lesson_spoke: boolean;
  lesson_grammar: string[];
  grammar_counts: Record<string, number>;
  scene: string;
  ambient: Ambient;
  on_stage: string[];
  yen: number;
  items: string[];
  trust: Record<string, number>;
  /** Empty until unlocked with the dictionary's phrase pages. */
  choices: Phrase[];
  choices_unlocked: boolean;
  battery: number;
  known_words: Record<string, KnownWord>;
  /** Key words heard but not yet looked up. */
  seen_words: string[];
  candos_done: string[];
  unlocked_skills?: Record<string, UnlockedSkill>;
  diary?: DiaryEntry[];
  /** Patience left per character in this scene. */
  patience?: Record<string, number>;
  timer?: { label: string; left: number; total: number } | null;
  /** Why the scene ran its course: "patience" or "timer". */
  scene_over?: string | null;
  /** The player's latest thought about what to try next. */
  lead?: string;
  /** People here the player can walk up to. */
  present?: string[];
  /** Who the player is talking with right now ("" when nobody). */
  talking_to?: string;
  /** The story graph as lived, for the flowchart. */
  flow?: FlowQuest[];
  /** The current objective: its step and the ways open (here, and elsewhere as [way, place]). */
  objective?: { quest: string; step_id: string; step: string; why: string; progress: string; here: string[]; elsewhere: [string, string][] } | null;
  ending: string | null;
}

export interface FlowBranch {
  label: string;
  /** The place's name once visited, else "". */
  at: string;
  status: "taken" | "open" | "closed" | "locked";
}
export interface FlowStep {
  title: string;
  status: "done" | "todo";
  branches: FlowBranch[];
}
export interface FlowQuest {
  /** "" while locked: not reached yet. */
  title: string;
  status: "done" | "active" | "locked";
  steps: FlowStep[];
}

export interface Run {
  id: string;
  state: RunState;
  lines: Line[];
  phrases: (Phrase & { lesson_idx: number })[];
  journal: { seq: number; text: string }[];
  scene_scores?: SceneScoreRow[];
}

export interface Coach {
  verdict: Verdict;
  note: string;
  better_jp: string;
  better_romaji: string;
  better_en: string;
  grammar_used: string[];
}

export interface TurnResult {
  player_line: Line;
  coach: Coach;
  beats: Line[];
  /** Index into `beats` where the arrival at a new place begins. */
  arrival_starts_at: number | null;
  moved_to: string | null;
  new_phrases: Phrase[];
  /** Words that just became owned. */
  mastered: Phrase[];
  /** Known words the player used this turn (with their new use count). */
  words_used: { jp: string; en: string; uses: number }[];
  /** "I can…" goals demonstrated this turn. */
  candos_done: CanDo[];
  /** RPG Skill Tree node unlocked or leveled up this turn. */
  skill_unlocked?: UnlockedSkill | null;
  /** The player tried to go past the end of the beta demo. */
  demo_end?: boolean;
  /** Characters whose patience ran out this turn. */
  departed?: string[];
  scene_over?: string | null;
  goal_complete: { place: string; journal: string; next_steps?: string[] } | null;
  /** Story-graph steps finished this turn: the scene ends. */
  steps_done?: string[];
  lesson_complete: { finished: number; next: number } | null;
  ending: string | null;
  state: RunState;
}

export interface TravelResult {
  beats: Line[];
  arrival_starts_at: number | null;
  /** Leaving after talking finished the scene being left. */
  goal_complete?: { place: string; journal: string; next_steps?: string[] } | null;
  moved_to?: string | null;
  state: RunState;
  /** The beta demo ends at that place for this player. */
  demo_end?: boolean;
}

export type InputVia = "voice" | "text" | "choice";

/** Uses on separate turns before a word is owned (server: game::OWN_AFTER). */
export const OWN_AFTER = 3;

export const NARRATOR = "narrator";
/** Townsfolk ids start with this (server: story::TOWNSFOLK_PREFIX). */
export const TOWNSFOLK_PREFIX = "folk_";
/** The player's inner monologue. */
export const THOUGHT = "thought";
export const EXTRA = "extra";
export const PLAYER = "you";

/** A signed-up player. */
export interface Account {
  id: string;
  email: string | null;
  display_name: string;
  role: "player" | "admin" | string;
  /** Plays past the beta demo (admins always do). */
  full_access?: boolean;
}

/** Where a player has got to in their latest run. */
export interface Progress {
  course: string;
  place: string;
  lesson: number;
  lesson_title: string;
  lessons_total: number;
  candos_done: number;
  candos_total: number;
  words_known: number;
  words_owned: number;
  scenes_cleared: number;
  places_visited: number;
  quest: string | null;
  finished: boolean;
}

export interface Invite {
  code: string;
  full_access: boolean;
  email: string | null;
  note: string;
  max_uses: number;
  uses: number;
  created_at: number;
  expires_at: number;
  revoked: boolean;
  link: string;
}

export interface Member {
  account: Account;
  joined: number;
  last_seen: number;
  runs: number;
  turns_today: number;
  progress: Progress | null;
}
