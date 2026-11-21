//! Game rules for the open world. The director proposes; this module
//! disposes. Every change it suggests is validated against the current
//! place's rules before it touches the save. The player moves between
//! places through exits; the curriculum is their own progress track, and
//! lessons complete through "I can…" goals checked against what the player
//! actually says.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::director::DirectorTurn;
use crate::story::{Action, Ambient, Beat, EXTRA, Exit, Lesson, NARRATOR, PLAYER, Phrase, Place, Quest, Story};

pub const MAX_BEATS_PER_TURN: usize = 5;
pub const TRANSCRIPT_LINES: usize = 14;
const TRUST_STEP: i64 = 2;
const TRUST_RANGE: i64 = 10;
/// Lesson turns without enough grammar before characters model phrases.
const HINT_AFTER: u32 = 6;
pub const MAX_INPUT_CHARS: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Playing,
    Complete,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RunStatus::Playing => "playing",
            RunStatus::Complete => "complete",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputVia {
    Voice,
    Text,
    Choice,
}

/// The whole save, stored as one JSON document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunState {
    /// Which course this run belongs to (saves before courses existed are Japanese).
    #[serde(default = "default_course")]
    pub course: String,
    pub player_name: String,
    pub status: RunStatus,

    pub place: String,
    pub place_turns: u32,
    pub place_yen_gained: i64,
    pub place_yen_spent: i64,
    pub visited: BTreeSet<String>,
    /// Places whose goal has been achieved.
    pub goals_done: BTreeSet<String>,
    pub flags: BTreeSet<String>,
    /// Lines are grouped by visit; this is the current visit's number.
    pub segment: usize,
    pub journal_seq: usize,

    /// Index into `story.lessons`.
    pub lesson_idx: usize,
    pub lesson_turns: u32,
    /// The player has to speak or type at least once per lesson — picking
    /// suggested replies alone can't finish one.
    pub lesson_spoke: bool,
    pub lesson_grammar: BTreeSet<String>,
    /// Lifetime count of correct uses per grammar point.
    pub grammar_counts: BTreeMap<String, u32>,

    pub scene: String,
    pub ambient: Ambient,
    pub on_stage: Vec<String>,
    pub yen: i64,
    pub items: Vec<String>,
    pub trust: BTreeMap<String, i64>,

    pub choices: Vec<Phrase>,
    /// Suggested replies stay hidden until the player spends battery on them.
    pub choices_unlocked: bool,
    pub battery: i64,
    /// Words revealed by the dictionary, by surface form.
    pub known_words: BTreeMap<String, KnownWord>,
    /// Key words the player has heard but not yet looked up.
    #[serde(default)]
    pub seen_words: BTreeSet<String>,
    /// "I can…" goals demonstrated.
    #[serde(default)]
    pub candos_done: BTreeSet<String>,
    /// RPG Skill Tree nodes unlocked passively through natural speech.
    #[serde(default)]
    pub unlocked_skills: BTreeMap<String, UnlockedSkill>,
    /// Detailed history of completed scenes for the player's Diary.
    #[serde(default)]
    pub diary: Vec<DiaryEntry>,
    pub ending: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlockedSkill {
    pub node_id: String,
    pub branch: String,
    pub title: String,
    pub title_jp: String,
    pub icon: String,
    /// Exact Japanese sentence the player spoke to unlock/demonstrate this node.
    pub sentence: String,
    /// Pronunciation accuracy score (0-100), if voice assessment was available.
    pub pron_score: Option<u32>,
    /// Coach verdict ("great", "good", "understood").
    pub verdict: String,
    /// Place ID where this skill was unlocked.
    pub place_id: String,
    /// Human-readable place name where this skill was unlocked.
    pub place_name: String,
    /// Unix timestamp (seconds) when unlocked.
    pub timestamp: i64,
    /// Mastery level: 1 (Spoken once), 2 (Spoken in 2 scenes), 3 (Mastered across 3+ visits).
    pub mastery_level: u8,
    /// Total times spoken across the run.
    pub uses: u32,
    /// Scene visit segments where this skill was used, to track cross-scene mastery.
    #[serde(default)]
    pub segments_used: BTreeSet<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiaryLineFeedback {
    pub line_id: i64,
    pub verdict: String,
    pub note: String,
    pub better_jp: String,
    pub better_romaji: String,
    pub better_en: String,
    #[serde(default)]
    pub grammar_used: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiaryEntry {
    pub id: String,
    pub place_id: String,
    pub place_name: String,
    pub place_name_jp: String,
    pub rank: String,
    pub score: i64,
    pub turns_used: i64,
    pub voice_turns: i64,
    pub difficulty: String,
    pub metrics: BTreeMap<String, i64>,
    pub lines: Vec<(i64, Beat)>,
    pub feedbacks: Vec<DiaryLineFeedback>,
    #[serde(default)]
    pub journal: Option<String>,
    pub reward_battery: i64,
    pub reward_trust: Vec<String>,
    pub created_at: i64,
}

fn default_course() -> String {
    "ja".to_string()
}

/// An exit as the client and the director see it.
#[derive(Debug, Clone, Serialize)]
pub struct ExitView {
    pub to: String,
    pub name: String,
    pub name_jp: String,
    pub label: String,
    pub open: bool,
    /// Why it's closed, in the player's own words.
    pub locked_reason: Option<String>,
    pub visited: bool,
}

impl RunState {
    /// A fresh run, standing in the start place; returns its intro beats.
    pub fn new(story: &Story, player_name: String) -> (Self, Vec<Beat>) {
        let mut s = RunState {
            course: story.course.id.clone(),
            player_name,
            status: RunStatus::Playing,
            place: String::new(),
            place_turns: 0,
            place_yen_gained: 0,
            place_yen_spent: 0,
            visited: BTreeSet::new(),
            goals_done: BTreeSet::new(),
            flags: BTreeSet::new(),
            segment: 0,
            journal_seq: 0,
            lesson_idx: 0,
            lesson_turns: 0,
            lesson_spoke: false,
            lesson_grammar: BTreeSet::new(),
            grammar_counts: BTreeMap::new(),
            scene: String::new(),
            ambient: Ambient::Clear,
            on_stage: Vec::new(),
            yen: 0,
            items: Vec::new(),
            trust: BTreeMap::new(),
            choices: Vec::new(),
            choices_unlocked: false,
            battery: story.device.start_battery,
            known_words: BTreeMap::new(),
            seen_words: BTreeSet::new(),
            candos_done: BTreeSet::new(),
            unlocked_skills: BTreeMap::new(),
            diary: Vec::new(),
            ending: None,
        };
        let intro = s.enter_place(story, &story.start_place.clone());
        (s, intro)
    }

    pub fn place<'a>(&self, story: &'a Story) -> &'a Place {
        story.place(&self.place).unwrap_or(&story.places[0])
    }

    pub fn lesson<'a>(&self, story: &'a Story) -> &'a Lesson {
        &story.lessons[self.lesson_idx.min(story.lessons.len() - 1)]
    }

    /// Moves the player; returns authored intro beats on a first visit
    /// (empty means the director should improvise an arrival).
    pub fn enter_place(&mut self, story: &Story, id: &str) -> Vec<Beat> {
        let Some(place) = story.place(id) else { return Vec::new() };
        let first_visit = self.visited.insert(place.id.clone());
        self.place = place.id.clone();
        self.segment += 1;
        self.place_turns = 0;
        self.place_yen_gained = 0;
        self.place_yen_spent = 0;
        self.scene = place.scene.clone();
        self.on_stage.clear();
        self.choices = place.choices.clone();
        self.choices_unlocked = false;
        for f in &place.on_enter_flags {
            self.flags.insert(f.clone());
        }
        let intro = if first_visit { place.intro.clone() } else { Vec::new() };
        for b in &intro {
            self.track_stage(b);
        }
        intro
    }

    /// Keeps `scene`, `ambient` and `on_stage` in sync with a beat, exactly
    /// the way the client will render it.
    fn track_stage(&mut self, b: &Beat) {
        if !b.scene.is_empty() && b.scene != self.scene {
            self.scene = b.scene.clone();
            self.on_stage.clear();
        }
        if !b.ambient.is_default() {
            self.ambient = b.ambient;
        }
        let is_cast = b.speaker != NARRATOR && b.speaker != EXTRA && b.speaker != PLAYER;
        if !is_cast {
            return;
        }
        match b.action {
            Action::ExitLeft | Action::ExitRight => self.on_stage.retain(|c| c != &b.speaker),
            _ if !self.on_stage.contains(&b.speaker) => self.on_stage.push(b.speaker.clone()),
            _ => {}
        }
    }

    /// Why an exit is closed, or `None` if it's open.
    pub fn exit_locked_reason(&self, story: &Story, e: &Exit) -> Option<String> {
        if self.lesson_idx < e.min_lesson && self.unlocked_skills.len() < e.min_lesson {
            let l = &story.lessons[e.min_lesson];
            return Some(story.course.locked_lesson.replace("{lesson}", &format!("{}: {}", l.index, l.title)));
        }
        if e.requires_flags.iter().any(|f| !self.flags.contains(f)) {
            return Some(story.course.locked_unknown.clone());
        }
        None
    }

    pub fn exits(&self, story: &Story) -> Vec<ExitView> {
        self.place(story)
            .exits
            .iter()
            .filter_map(|e| {
                let to = story.place(&e.to)?;
                let reason = self.exit_locked_reason(story, e);
                Some(ExitView {
                    to: to.id.clone(),
                    name: to.name.clone(),
                    name_jp: to.name_jp.clone(),
                    label: e.label.clone(),
                    open: reason.is_none(),
                    locked_reason: reason,
                    visited: self.visited.contains(&to.id),
                })
            })
            .collect()
    }

    pub fn can_go(&self, story: &Story, to: &str) -> bool {
        self.place(story).exits.iter().any(|e| e.to == to && self.exit_locked_reason(story, e).is_none())
    }

    /// The first step of the big arc not yet achieved.
    pub fn current_quest<'a>(&self, story: &'a Story) -> Option<&'a Quest> {
        story.quests.iter().find(|q| !q.flags_any.iter().any(|f| self.flags.contains(f)))
    }

    /// Target grammar for the current lesson that hasn't been shown yet.
    pub fn missing_grammar<'a>(&self, story: &'a Story) -> Vec<&'a str> {
        self.lesson(story)
            .grammar
            .iter()
            .map(|g| g.id.as_str())
            .filter(|id| !self.lesson_grammar.contains(*id))
            .collect()
    }

    /// Grants battery and character trust rewards based on scene scorecard rank (S/A/B/C).
    /// Returns `(battery_gained, characters_awarded_trust)`.
    pub fn apply_scene_reward(&mut self, story: &Story, place_id: &str, rank: &str) -> (i64, Vec<String>) {
        let battery_delta = match rank {
            "S" => 30,
            "A" => 20,
            "B" => 10,
            _ => 0,
        };
        let old_battery = self.battery;
        self.battery = (self.battery + battery_delta).clamp(0, 100);
        let actual_battery = self.battery - old_battery;

        let mut trusted = Vec::new();
        if rank == "S" {
            let cast_ids: Vec<String> = story
                .place(place_id)
                .map(|p| p.cast.clone())
                .unwrap_or_else(|| self.on_stage.clone());
            for cid in cast_ids {
                let v = self.trust.entry(cid.clone()).or_default();
                *v = (*v + 1).clamp(-TRUST_RANGE, TRUST_RANGE);
                trusted.push(cid);
            }
        }
        (actual_battery, trusted)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CoachView {
    pub verdict: &'static str,
    pub note: String,
    pub better_jp: String,
    pub better_romaji: String,
    pub better_en: String,
    pub grammar_used: Vec<String>,
}

pub struct GoalComplete {
    pub place: String,
    pub journal: String,
}

pub struct TurnOutcome {
    pub coach: CoachView,
    /// "I can…" goals demonstrated this turn.
    pub candos_done: Vec<String>,
    /// RPG Skill Tree node unlocked or leveled up this turn.
    pub skill_unlocked: Option<UnlockedSkill>,
    pub beats: Vec<Beat>,
    pub new_phrases: Vec<Phrase>,
    pub goal_complete: Option<GoalComplete>,
    /// Index of the lesson just finished.
    pub lesson_complete: Option<usize>,
    /// An open exit the director moved the player through.
    pub go_to: Option<String>,
}

/// The mode of a director call.
pub enum Prompt<'a> {
    Turn { input: &'a str, via: InputVia },
    /// The player just walked in from `from` (None on the very first scene).
    Arrival { from: Option<&'a str> },
}

/// Stable per lesson, so it is cached as its own prefix segment.
pub fn lesson_brief(story: &Story, idx: usize) -> String {
    let l = &story.lessons[idx];
    let grammar: String = l
        .grammar
        .iter()
        .map(|g| format!("- `{}` {} — {}. e.g. {} ({})\n", g.id, g.pattern, g.meaning, g.example_jp, g.example_en))
        .collect();
    let earlier: Vec<String> = story.lessons[..idx].iter().flat_map(|l| l.grammar.iter().map(|g| g.pattern.clone())).collect();
    let vocab: Vec<String> = l.vocab.iter().map(|v| format!("{} ({}) = {}", v.jp, v.romaji, v.en)).collect();
    format!(
        "CURRENT LESSON {idx} — {title} ({title_jp}): {topic}\n\
         Shape situations so the player naturally needs this lesson's grammar — through what characters ask and what happens next, never by making them repeat or recite.\n\n\
         TARGET GRAMMAR (use these ids in grammar_used):\n{grammar}\n\
         Grammar from earlier lessons the player has met: {earlier}\n\
         Useful vocabulary: {vocab}\n",
        title = l.title,
        title_jp = l.title_jp,
        topic = l.topic,
        earlier = if earlier.is_empty() { "none yet".into() } else { earlier.join(", ") },
        vocab = vocab.join("; "),
    )
}

/// Builds the user message for the director: state, place, exits,
/// recent transcript, then the player's words (or an arrival cue).
pub fn director_message(story: &Story, state: &RunState, transcript: &[Beat], prompt: Prompt) -> String {
    let place = state.place(story);
    let name = |id: &str| story.cast_member(id).map(|c| c.name.clone()).unwrap_or_else(|| id.to_string());

    let mut lines = String::new();
    let start = transcript.len().saturating_sub(TRANSCRIPT_LINES);
    for b in &transcript[start..] {
        let who = match b.speaker.as_str() {
            NARRATOR => "Narrator".to_string(),
            PLAYER => format!("{} (player)", state.player_name),
            EXTRA => b.speaker_name.clone(),
            id => name(id),
        };
        if b.jp.is_empty() {
            lines.push_str(&format!("{who}: {}\n", b.en));
        } else if b.en.is_empty() {
            lines.push_str(&format!("{who}: {}\n", b.jp));
        } else {
            lines.push_str(&format!("{who}: {} ({})\n", b.jp, b.en));
        }
    }

    let trust: Vec<String> = state.trust.iter().map(|(k, v)| format!("{k} {v:+}")).collect();
    let known: Vec<String> = state
        .known_words
        .iter()
        .filter(|(_, w)| w.kind != "particle")
        .map(|(jp, w)| format!("{jp}={}{}", w.en, if w.mastered { "✓" } else { "" }))
        .collect();
    let lesson = state.lesson(story);
    let missing = state.missing_grammar(story);
    let hint = if state.lesson_turns >= HINT_AFTER && state.lesson_grammar.len() < lesson.min_grammar {
        "\nHINT MODE: the player has been stuck on this lesson for a while. Have a character casually use the phrase they need in their own reply, so the player can borrow it."
    } else {
        ""
    };
    let cast: Vec<String> = place.cast.iter().map(|c| format!("`{c}` ({})", name(c))).collect();
    let next_open_exit = state
        .exits(story)
        .into_iter()
        .find(|e| e.open)
        .and_then(|e| story.place(&e.to))
        .map(|p| format!("`{}` ({} / {})", p.id, p.name_jp, p.name));
    let goal_state = if state.goals_done.contains(&place.id) {
        format!(
            "ALREADY ACHIEVED — this is free conversation and practice now; keep objective_complete false. Have the character naturally wrap up and guide the player toward {}; Choice #3 MUST be a departure phrase heading there.",
            next_open_exit.unwrap_or_else(|| "an open exit".into())
        )
    } else {
        format!(
            "NOT YET — success condition: {} (Once met, set objective_complete: true and make Choice #3 a departure phrase toward {}).",
            place.success.trim(),
            next_open_exit.unwrap_or_else(|| "an open exit".into())
        )
    };
    let events: Vec<String> = place
        .events
        .iter()
        .filter(|e| !state.flags.contains(&e.flag))
        .map(|e| format!("- `{}` when {}", e.flag, e.when))
        .collect();
    let exits: Vec<String> = state
        .exits(story)
        .iter()
        .map(|e| match &e.locked_reason {
            None => format!("- `{}` — {} [OPEN]", e.to, e.label),
            Some(r) => format!("- `{}` — {} [LOCKED: {r}]", e.to, e.label),
        })
        .collect();

    let lesson_candos: Vec<String> = lesson
        .candos
        .iter()
        .map(|c| format!("[{}] {} — e.g. {}", if state.candos_done.contains(&c.id) { "x" } else { " " }, c.text, c.example))
        .collect();
    let pack: Vec<String> = place
        .pack
        .iter()
        .map(|w| {
            let met = state.known_words.contains_key(&w.jp) || state.seen_words.contains(&w.jp);
            format!("{} ({}) = {}{}", w.jp, w.romaji, w.en, if met { " ✓met" } else { "" })
        })
        .collect();
    let featured: Vec<String> = place
        .candos
        .iter()
        .filter(|id| !state.candos_done.contains(*id))
        .filter_map(|id| story.cando(id))
        .map(|c| format!("{} — e.g. {}", c.text, c.example))
        .collect();
    let teaching_block = format!(
        "<teaching>\n\
         KEY WORDS for this place (seed unmet ones early, two or three times, with gestures): {pack}\n\
         \"I can…\" goals of the current lesson ([x] = done): {candos}\n\
         This place is designed for: {featured}\n\
         Create a natural moment where the player needs to say one of the open goals; never tell them to say it.\n\
         </teaching>",
        pack = if pack.is_empty() { "none".into() } else { pack.join("; ") },
        candos = if lesson_candos.is_empty() { "none".into() } else { lesson_candos.join(" | ") },
        featured = if featured.is_empty() { "nothing open — free conversation".into() } else { featured.join(" | ") },
    );

    let prev_choices: Vec<String> = state.choices.iter().map(|c| format!("{} ({})", c.jp, c.en)).collect();
    let state_block = format!(
        "<game_state>\n\
         player name: {pname}\n\
         place: {place} ({place_id}), {clock}; on stage: {stage}\n\
         money: ¥{yen}; items: {items}; trust: {trust}\n\
         the player's big goal right now: {quest}\n\
         lesson progress: turn {lt} of lesson {li}; target grammar shown: {shown}; not yet: {missing}{hint}\n\
         words the player knows (looked up; ✓ = used themselves): {known}\n\
         story flags: {flags}\n\
         previous_choices (DO NOT repeat any of these; generate 3 completely new choices): {prev_choices}\n\
         </game_state>",
        pname = state.player_name,
        place = place.name,
        place_id = place.id,
        clock = place.clock,
        stage = if state.on_stage.is_empty() { "nobody".into() } else { state.on_stage.join(", ") },
        yen = state.yen,
        items = if state.items.is_empty() { "nothing".into() } else { state.items.join(", ") },
        trust = if trust.is_empty() { "neutral".into() } else { trust.join(", ") },
        quest = state.current_quest(story).map(|q| q.title.as_str()).unwrap_or("none — the story is over"),
        lt = state.lesson_turns + 1,
        li = lesson.index,
        shown = join_or(&state.lesson_grammar.iter().map(String::as_str).collect::<Vec<_>>(), "none"),
        missing = join_or(&missing, "none"),
        known = if known.is_empty() { "none yet".to_string() } else { known.join(", ") },
        flags = if state.flags.is_empty() { "none".to_string() } else { state.flags.iter().cloned().collect::<Vec<_>>().join(", ") },
        prev_choices = if prev_choices.is_empty() { "none".to_string() } else { prev_choices.join(" | ") },
    );
    let place_block = format!(
        "<place>\n\
         {name} ({name_jp}) — scene `{scene}`\n\
         Situation: {situation}\n\
         People here: {cast}\n\
         The player's goal here (their own thought): {goal}\n\
         Goal status: {goal_state}\n\
         Story events you may trigger here (set the flag in flags_set only when it happens on screen):\n{events}\n\
         Exits (set go_to only to an OPEN one):\n{exits}\n\
         </place>",
        name = place.name,
        name_jp = place.name_jp,
        scene = place.scene,
        situation = place.situation.trim(),
        cast = if cast.is_empty() { "only minor characters (use speaker \"extra\")".into() } else { cast.join(", ") },
        goal = place.goal,
        events = if events.is_empty() { "none".into() } else { events.join("\n") },
        exits = if exits.is_empty() { "none — this is the end of the line".into() } else { exits.join("\n") },
    );
    let ask = match prompt {
        Prompt::Turn { input, via } => format!(
            "<player_said via=\"{via}\">{input}</player_said>",
            via = match via {
                InputVia::Voice => "voice",
                InputVia::Text => "text",
                InputVia::Choice => "suggested_reply",
            }
        ),
        Prompt::Arrival { from } => format!(
            "<arrival from=\"{from}\"/>\n\
             The player has just arrived here. Write 1–4 beats that set the scene through the player's eyes and have whoever is here notice them (use enter_left / enter_right). \
             There is no player line to judge: coach.verdict \"none\", grammar_used [], objective_complete false, go_to \"stay\", flags_set []. Still give 3 fitting choices.",
            from = from.and_then(|f| story.place(f)).map(|p| p.name.as_str()).unwrap_or("nowhere — the story begins"),
        ),
    };

    format!("{state_block}\n\n{place_block}\n\n{teaching_block}\n\n<transcript>\n{lines}</transcript>\n\n{ask}")
}

fn join_or(v: &[&str], empty: &str) -> String {
    if v.is_empty() { empty.to_string() } else { v.join(", ") }
}

/// Filters director beats to what this place allows and tracks the stage.
/// Letters and digits only, lowercased: for comparing lines loosely.
fn squash(s: &str) -> String {
    to_hiragana(&s.to_lowercase()).chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Is this line just the player's own words handed back? The client
/// already shows what the player said, and a character parroting it reads
/// as a glitch.
fn echoes(line: &str, said: &str) -> bool {
    let (l, s) = (squash(line), squash(said));
    let (short, long) = if l.chars().count() <= s.chars().count() { (&l, &s) } else { (&s, &l) };
    !short.is_empty() && long.contains(short.as_str()) && short.chars().count() * 5 >= long.chars().count() * 4
}

fn accept_beats(story: &Story, state: &mut RunState, raw: Vec<Beat>, said: &str) -> Vec<Beat> {
    let place = state.place(story).clone();
    let mut beats = Vec::new();
    for mut b in raw.into_iter().take(MAX_BEATS_PER_TURN) {
        if !said.is_empty() && b.speaker != NARRATOR && echoes(&b.jp, said) {
            continue;
        }
        // Scene changes happen by moving between places, not mid-scene.
        b.scene.clear();
        let speaker_ok = b.speaker == NARRATOR || b.speaker == EXTRA || place.cast.contains(&b.speaker);
        if !speaker_ok {
            // Keep the line but voice it as a named extra.
            b.speaker_name = story.cast_member(&b.speaker).map(|c| c.name.clone()).unwrap_or_default();
            b.speaker = EXTRA.into();
        }
        if b.speaker == EXTRA && b.speaker_name.is_empty() {
            b.speaker_name = "???".into();
        }
        if b.speaker == NARRATOR {
            b.jp.clear();
            b.romaji.clear();
        }
        if b.jp.is_empty() && b.en.is_empty() {
            continue;
        }
        state.track_stage(&b);
        beats.push(b);
    }
    beats
}

fn take_choices(state: &mut RunState, choices: Vec<Phrase>) {
    let choices: Vec<Phrase> = choices.into_iter().filter(|c| !c.jp.trim().is_empty()).take(3).collect();
    if !choices.is_empty() {
        state.choices = choices;
    }
    state.choices_unlocked = false;
}

/// Words that mean "I'm going (there)", in Japanese and English.
const GOING: &[&str] = &[
    // Not bare いく (いくら = "how much") or いって (言って = "say").
    "いきます", "いきましょう", "いこう", "いきたい", "いくよ", "いくね", "むかいます", "かえります", "もどります",
    "go to", "going to", "go back", "head to", "heading", "let's go", "lets go", "i'll go", "ill go", "leave", "walk to", "take me",
];

/// The open exit the player clearly said they're heading to, if any: a
/// "going" word plus exactly one exit's name or alias. The player's stated
/// intent wins even when the director forgets to set go_to.
pub fn intended_exit(story: &Story, state: &RunState, input: &str) -> Option<String> {
    let said = to_hiragana(&input.to_lowercase());
    let kanji_going = ["行きます", "行く", "行きましょう", "行こう", "行って", "向かいます", "帰ります", "戻ります"];
    if !GOING.iter().any(|g| said.contains(g)) && !kanji_going.iter().any(|g| input.contains(g)) {
        return None;
    }
    // Each open exit scores by its longest name found in what was said, so
    // "Mr. Russo's room" means Russo's place, not the dorm "room".
    let mut hits: Vec<(usize, &str)> = state
        .exits(story)
        .into_iter()
        .filter(|e| e.open)
        .filter_map(|e| {
            let p = story.place(&e.to)?;
            let best = std::iter::once(p.name.to_lowercase())
                .chain(std::iter::once(p.name_jp.clone()))
                .chain(p.aliases.iter().map(|a| to_hiragana(&a.to_lowercase())))
                .filter(|n| !n.is_empty() && said.contains(n.as_str()))
                .map(|n| n.chars().count())
                .max()?;
            Some((best, p.id.as_str()))
        })
        .collect();
    hits.sort_by_key(|h| std::cmp::Reverse(h.0));
    hits.dedup_by(|a, b| a.1 == b.1);
    match hits.as_slice() {
        [(_, only)] => Some(only.to_string()),
        [(a, first), (b, _), ..] if a > b => Some(first.to_string()),
        _ => None,
    }
}

/// Validates a director turn and applies it to the run.
#[allow(dead_code)]
pub fn apply_turn(story: &Story, state: &mut RunState, turn: DirectorTurn, via: InputVia, input: &str) -> TurnOutcome {
    apply_turn_with_pron(story, state, turn, via, input, None)
}

/// Validates a director turn and applies it to the run, recording optional pronunciation accuracy.
pub fn apply_turn_with_pron(
    story: &Story,
    state: &mut RunState,
    turn: DirectorTurn,
    via: InputVia,
    input: &str,
    pron_score: Option<u32>,
) -> TurnOutcome {
    let place = state.place(story).clone();
    state.place_turns += 1;
    state.lesson_turns += 1;
    if via != InputVia::Choice {
        state.lesson_spoke = true;
    }

    // Curriculum: credit real grammar ids; the lesson counts its own targets.
    let lesson_ids: BTreeSet<&str> = state.lesson(story).grammar.iter().map(|g| g.id.as_str()).collect();
    let all_ids: BTreeSet<&str> = story.all_grammar_ids().into_iter().collect();
    let mut grammar_used = Vec::new();
    for g in turn.grammar_used {
        if !all_ids.contains(g.as_str()) || grammar_used.contains(&g) {
            continue;
        }
        *state.grammar_counts.entry(g.clone()).or_default() += 1;
        if lesson_ids.contains(g.as_str()) {
            state.lesson_grammar.insert(g.clone());
        }
        grammar_used.push(g);
    }

    // Can-dos count only for the player's own words (not a picked reply)
    // that the listener understood.
    use crate::story::Verdict;
    let understood = matches!(turn.coach.verdict, Verdict::Great | Verdict::Good | Verdict::Understood);
    let candos_done = if via == InputVia::Choice { Vec::new() } else { check_candos(story, state, input, understood) };
    let skill_unlocked = if via == InputVia::Choice {
        None
    } else {
        update_skill_tree(
            story,
            state,
            input,
            &grammar_used,
            &candos_done,
            understood,
            turn.coach.verdict.as_str(),
            pron_score,
        )
    };

    let mut beats = accept_beats(story, state, turn.beats, input);
    if beats.is_empty() {
        beats.push(Beat::narration(if understood { &story.course.nod } else { &story.course.pause }));
    }

    // Money: clamp to this place's budget and never below zero.
    let delta = turn.state.yen_delta;
    if delta > 0 {
        let gain = delta.min((place.max_yen_gain - state.place_yen_gained).max(0));
        state.place_yen_gained += gain;
        state.yen += gain;
    } else if delta < 0 {
        let spend = (-delta).min((place.max_yen_spend - state.place_yen_spent).max(0)).min(state.yen);
        state.place_yen_spent += spend;
        state.yen -= spend;
    }
    for item in turn.state.items_gained {
        if place.items_allowed.contains(&item) && !state.items.contains(&item) {
            state.items.push(item);
        }
    }
    for item in turn.state.items_lost {
        if place.items_allowed.contains(&item) {
            state.items.retain(|i| i != &item);
        }
    }
    for t in turn.state.trust {
        if place.cast.contains(&t.character) || state.on_stage.contains(&t.character) {
            let v = state.trust.entry(t.character).or_default();
            *v = (*v + t.delta.clamp(-TRUST_STEP, TRUST_STEP)).clamp(-TRUST_RANGE, TRUST_RANGE);
        }
    }

    // Story events: only this place's, only once.
    let goal_flags_set = !place.goal_flags.is_empty() && place.goal_flags.iter().all(|gf| turn.flags_set.contains(gf));
    for f in turn.flags_set {
        if place.events.iter().any(|e| e.flag == f) || place.goal_flags.contains(&f) {
            state.flags.insert(f);
        }
    }

    take_choices(state, turn.choices);
    let new_phrases: Vec<Phrase> = turn.new_phrases.into_iter().filter(|p| !p.jp.trim().is_empty()).take(2).collect();

    // The place's goal: once, after the player has actually engaged.
    // Also auto-completes if the director triggered all goal_flags or granted the full scene reward_yen.
    let reward_granted = place.reward_yen > 0 && state.place_yen_gained >= place.reward_yen;
    let mut goal_complete = None;
    if (turn.objective_complete || goal_flags_set || reward_granted) && state.place_turns >= 1 && !state.goals_done.contains(&place.id) {
        state.goals_done.insert(place.id.clone());
        for f in &place.goal_flags {
            state.flags.insert(f.clone());
        }
        let owed = (place.reward_yen - state.place_yen_gained).max(0);
        state.yen += owed;
        state.place_yen_gained += owed;
        for item in &place.reward_items {
            if !state.items.contains(item) {
                state.items.push(item.clone());
            }
        }
        state.battery = (state.battery + place.recharge).min(100);
        let journal = if turn.journal.trim().is_empty() {
            format!("{} — I did it, one word at a time.", place.name)
        } else {
            turn.journal
        };
        goal_complete = Some(GoalComplete { place: place.id.clone(), journal });
    }

    // Once the current place's goal is achieved, ensure at least one suggested choice
    // lets the player depart to the primary open exit so they never get stuck in a loop.
    if state.goals_done.contains(&place.id) && turn.go_to == "stay" && !state.choices.is_empty() {
        let has_exit_choice = state
            .choices
            .iter()
            .any(|c| intended_exit(story, state, &c.jp).is_some() || intended_exit(story, state, &c.en).is_some());
        #[allow(clippy::collapsible_if)]
        if !has_exit_choice {
            if let Some(next_place) = state.exits(story).into_iter().find(|e| e.open).and_then(|e| story.place(&e.to)) {
                let exit_phrase = if story.course.target_lang == "ja" {
                    let (jp, romaji) = if next_place.id == "airport_station" {
                        ("駅に行きます。ありがとうございました。".to_string(), "Eki ni ikimasu. Arigatou gozaimashita.".to_string())
                    } else if next_place.id == "koban" {
                        ("交番に行きます。ありがとうございます。".to_string(), "Kouban ni ikimasu. Arigatou gozaimasu.".to_string())
                    } else {
                        (format!("{}に行きます。ありがとうございました。", next_place.name_jp), String::new())
                    };
                    Phrase {
                        jp,
                        romaji,
                        en: format!("I'll head to {}. Thank you!", next_place.name),
                    }
                } else {
                    Phrase {
                        jp: format!("I'm going to {} now. Thank you!", next_place.name),
                        romaji: String::new(),
                        en: format!("{}へ行きます。ありがとう！", next_place.name_jp),
                    }
                };
                if state.choices.len() >= 3 {
                    state.choices[2] = exit_phrase;
                } else {
                    state.choices.push(exit_phrase);
                }
            }
        }
    }

    // Flexible lesson leveling: advance if the player hits >= 60% of the lesson's
    // Can-Dos OR has spoken for >= 5 turns in this lesson, never blocking natural speech.
    let mut lesson_complete = None;
    let lesson = state.lesson(story);
    let candos_total = lesson.candos.len();
    let candos_hit = lesson.candos.iter().filter(|c| state.candos_done.contains(&c.id)).count();
    let candos_60_pct = candos_total > 0 && (candos_hit * 5 >= candos_total * 3);
    let spoken_5_turns = state.lesson_turns >= 5;
    let lesson_met = if lesson.candos.is_empty() {
        (state.lesson_turns >= lesson.min_turns && state.lesson_grammar.len() >= lesson.min_grammar) || spoken_5_turns
    } else {
        candos_60_pct || spoken_5_turns
    };
    if lesson_met && state.lesson_spoke && state.lesson_idx + 1 < story.lessons.len() {
        lesson_complete = Some(state.lesson_idx);
        state.lesson_idx += 1;
        state.lesson_turns = 0;
        state.lesson_spoke = false;
        state.lesson_grammar.clear();
    }

    let go_to = (turn.go_to != "stay" && turn.go_to != place.id && state.can_go(story, &turn.go_to)).then_some(turn.go_to);

    TurnOutcome {
        candos_done,
        skill_unlocked,
        coach: CoachView {
            verdict: turn.coach.verdict.as_str(),
            note: turn.coach.note,
            better_jp: turn.coach.better_jp,
            better_romaji: turn.coach.better_romaji,
            better_en: turn.coach.better_en,
            grammar_used,
        },
        beats,
        new_phrases,
        goal_complete,
        lesson_complete,
        go_to,
    }
}

/// Applies an improvised arrival: only beats and choices count.
pub fn apply_arrival(story: &Story, state: &mut RunState, turn: DirectorTurn) -> Vec<Beat> {
    let beats = accept_beats(story, state, turn.beats, "");
    take_choices(state, turn.choices);
    beats
}

/// World triggers whose conditions now hold: sets their flags and returns
/// their narration.
pub fn run_triggers(story: &Story, state: &mut RunState) -> Vec<Beat> {
    let mut out = Vec::new();
    for t in &story.triggers {
        if !state.flags.contains(&t.flag)
            && state.lesson_idx >= t.min_lesson
            && t.requires_flags.iter().all(|f| state.flags.contains(f))
        {
            state.flags.insert(t.flag.clone());
            out.push(Beat::narration(&t.narration));
        }
    }
    out
}

/// If an ending's flag is set, finishes the run and returns its beats.
pub fn check_ending(story: &Story, state: &mut RunState) -> Option<Vec<Beat>> {
    if state.status == RunStatus::Complete {
        return None;
    }
    let ending = story.endings.iter().find(|e| state.flags.contains(&e.flag))?;
    state.status = RunStatus::Complete;
    state.ending = Some(ending.flag.clone());
    state.choices.clear();
    for b in &ending.beats {
        state.track_stage(b);
    }
    Some(ending.beats.clone())
}


/// A word the player has looked up. It's glossed whenever it reappears
/// until the player uses it themselves, which masters it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownWord {
    pub romaji: String,
    pub en: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub note: String,
    /// True once owned: used successfully on OWN_AFTER separate visits.
    #[serde(default)]
    pub mastered: bool,
    /// Separate visits on which the player used the word themselves.
    #[serde(default)]
    pub uses: u32,
    #[serde(default)]
    pub last_use_segment: usize,
}

/// A word is owned after this many uses on separate visits (spaced use).
pub const OWN_AFTER: u32 = 3;

/// Katakana → hiragana, so カバン matches かばん.
fn to_hiragana(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\u{30A1}'..='\u{30F6}' => char::from_u32(c as u32 - 0x60).unwrap_or(c),
            _ => c,
        })
        .collect()
}

/// Loose romaji for matching typed input: lowercase letters only, long
/// vowels spelled out.
fn norm_romaji(s: &str) -> String {
    s.to_lowercase()
        .replace('ā', "aa")
        .replace('ī', "ii")
        .replace('ū', "uu")
        .replace('ē', "ee")
        .replace('ō', "ou")
        .chars()
        .filter(|c| c.is_ascii_lowercase())
        .collect()
}

/// Polite endings that shouldn't stop a word from matching (大丈夫ですか ≈ 大丈夫).
const ENDINGS_KANA: &[&str] = &["ですか", "でした", "です", "か", "ね", "よ"];
const ENDINGS_ROMAJI: &[&str] = &["desuka", "deshita", "desu", "ka"];

fn strip_endings(s: &str, endings: &[&str]) -> String {
    for e in endings {
        if let Some(stem) = s.strip_suffix(e)
            && stem.chars().count() >= 2
        {
            return stem.to_string();
        }
    }
    s.to_string()
}

/// (surface form, word) pairs.
pub type WordList = Vec<(String, KnownWord)>;

/// Words the player just used themselves: each known word counts once per
/// visit, and becomes owned after `OWN_AFTER` separate visits. Returns
/// (words used this turn, words that just became owned).
pub fn record_word_uses(state: &mut RunState, input: &str) -> (WordList, WordList) {
    let kana = to_hiragana(input);
    let roma = norm_romaji(input);
    let segment = state.segment;
    let (mut used, mut owned) = (Vec::new(), Vec::new());
    for (jp, w) in state.known_words.iter_mut() {
        if w.mastered || w.kind == "particle" || jp.chars().count() < 2 || w.last_use_segment == segment {
            continue;
        }
        let stem = strip_endings(&to_hiragana(jp), ENDINGS_KANA);
        let r = strip_endings(&norm_romaji(&w.romaji), ENDINGS_ROMAJI);
        let said = kana.contains(&stem) || (r.len() >= 3 && roma.contains(&r));
        if said {
            w.uses += 1;
            w.last_use_segment = segment;
            used.push((jp.clone(), w.clone()));
            if w.uses >= OWN_AFTER {
                w.mastered = true;
                owned.push((jp.clone(), w.clone()));
            }
        }
    }
    (used, owned)
}

/// Lowercased, space-separated latin words, for word-boundary matching.
fn latin_words(s: &str) -> String {
    let words: Vec<String> = s
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty() && w.is_ascii())
        .map(|w| w.replace('\'', ""))
        .collect();
    format!(" {} ", words.join(" "))
}

/// Does one accepted form appear in what the player said? Japanese forms
/// match on kana (カバン = かばん); latin forms match at a word start, so
/// "nusumare" matches "nusumaremashita" but "lost" never matches "almost";
/// a leading `*` lets a latin form match inside a word ("*jin").
fn form_matches(form: &str, kana: &str, latin: &str) -> bool {
    let f = form.trim();
    if f.is_empty() {
        return false;
    }
    if !f.is_ascii() {
        kana.contains(&to_hiragana(f.to_lowercase().trim_start_matches('*')))
    } else if let Some(inner) = f.strip_prefix('*') {
        // "*jin" matches inside a word: amerikajin.
        latin.replace(' ', "").contains(&latin_words(inner).replace(' ', ""))
    } else {
        let lw = latin_words(f);
        latin.contains(lw.trim_end())
    }
}

/// The input with a can-do's look-alike phrases blanked out.
fn without_ignored(ignore: &[String], kana: &str, latin: &str) -> (String, String) {
    let mut kana = kana.to_string();
    let mut latin = latin.to_string();
    for f in ignore.iter().map(|f| f.trim()).filter(|f| !f.is_empty()) {
        if f.is_ascii() {
            latin = latin.replace(&latin_words(f), " ");
        } else {
            kana = kana.replace(&to_hiragana(&f.to_lowercase()), " ");
        }
    }
    (kana, latin)
}

/// "I can…" goals the player just demonstrated: their line matches every
/// group of a can-do and the listener understood them.
pub fn check_candos(story: &Story, state: &mut RunState, input: &str, understood: bool) -> Vec<String> {
    if !understood {
        return Vec::new();
    }
    let kana = to_hiragana(&input.to_lowercase());
    let latin = latin_words(input);
    let mut done = Vec::new();
    for lesson in story.lessons.iter().take(state.lesson_idx + 2) {
        for c in &lesson.candos {
            if state.candos_done.contains(&c.id) {
                continue;
            }
            let (kana, latin) = without_ignored(&c.ignore, &kana, &latin);
            if c.match_all.iter().all(|group| group.iter().any(|f| form_matches(f, &kana, &latin))) {
                state.candos_done.insert(c.id.clone());
                done.push(c.id.clone());
            }
        }
    }
    done
}

struct SkillSpec {
    node_id: &'static str,
    branch: &'static str,
    title: &'static str,
    title_jp: &'static str,
    icon: &'static str,
    grammar_ids: &'static [&'static str],
    cando_ids: &'static [&'static str],
}

const SKILL_SPECS: &[SkillSpec] = &[
    // Branch 1: Social & Connection (🤝)
    SkillSpec {
        node_id: "social_greetings",
        branch: "social",
        title: "Greetings & Well-being",
        title_jp: "あいさつ",
        icon: "🌿",
        grammar_ids: &["g0_daijoubu", "g0_sumimasen", "g0_hai_iie", "g0_wakarimasen", "g0_arigatou"],
        cando_ids: &["l0_okay", "l0_sorry", "l0_thanks", "l0_dont_understand"],
    },
    SkillSpec {
        node_id: "social_intro",
        branch: "social",
        title: "Introductions & Identity",
        title_jp: "自己紹介",
        icon: "🪪",
        grammar_ids: &["g1_x_wa_y_desu", "g1_ka_question", "g1_no_modifier", "g1_nationality"],
        cando_ids: &["l1_name", "l1_from", "l1_ask"],
    },
    SkillSpec {
        node_id: "social_likes",
        branch: "social",
        title: "Small Talk & Likes",
        title_jp: "すきです",
        icon: "💬",
        grammar_ids: &["g5_adjectives", "g5_suki", "g5_mashou", "g8_no_ga_suki"],
        cando_ids: &["c5_describe", "c5_like", "c5_lets", "c5_ask_opinion", "c8_like_doing"],
    },
    SkillSpec {
        node_id: "social_casual",
        branch: "social",
        title: "Casual Plain Form",
        title_jp: "タメ口",
        icon: "🍻",
        grammar_ids: &["g8_short_present", "g8_to_omoimasu", "g8_to_itte_imashita", "g9_short_past", "g9_kara_reason"],
        cando_ids: &["c8_think", "c8_said", "c9_past_opinion", "c9_because"],
    },
    // Branch 2: Survival & Navigation (🧭)
    SkillSpec {
        node_id: "survival_existence",
        branch: "survival",
        title: "Existence & Missing Items",
        title_jp: "あります/います",
        icon: "🔍",
        grammar_ids: &["g4_arimasu_imasu"],
        cando_ids: &["l2_lost", "l4_is_there"],
    },
    SkillSpec {
        node_id: "survival_locations",
        branch: "survival",
        title: "Locations & Spatial Words",
        title_jp: "うえ/した/となり",
        icon: "📍",
        grammar_ids: &["g2_doko", "g4_location_words"],
        cando_ids: &["l2_where", "l4_location"],
    },
    SkillSpec {
        node_id: "survival_transit",
        branch: "survival",
        title: "Directions & Transit",
        title_jp: "駅に行きます",
        icon: "🚆",
        grammar_ids: &["g3_ni_e_destination", "g3_de_means_place"],
        cando_ids: &["l3_going"],
    },
    // Branch 3: Commerce & Dining (🛒)
    SkillSpec {
        node_id: "commerce_demo",
        branch: "commerce",
        title: "Demonstratives & Items",
        title_jp: "これ/それ/あれ",
        icon: "👉",
        grammar_ids: &["g2_kore_sore_are", "g2_dare_no", "g2_ja_arimasen", "g2_mo"],
        cando_ids: &["l2_not_mine"],
    },
    SkillSpec {
        node_id: "commerce_prices",
        branch: "commerce",
        title: "Prices & Comparisons",
        title_jp: "いくら",
        icon: "💴",
        grammar_ids: &["g3_ikura", "g10_yori", "g10_ichiban"],
        cando_ids: &["l3_price", "c10_compare", "c10_most"],
    },
    SkillSpec {
        node_id: "commerce_requests",
        branch: "commerce",
        title: "Ordering & Requests",
        title_jp: "〜をください / 〜てください",
        icon: "🍱",
        grammar_ids: &["g3_o_object", "g6_te_kudasai", "g6_te_mo_ii", "g6_te_wa_ikemasen", "g8_naide_kudasai"],
        cando_ids: &["l3_request", "c6_please_do", "c6_may_i", "c6_rule", "c8_dont"],
    },
    // Branch 4: Daily Life & Desires (⏱️)
    SkillSpec {
        node_id: "daily_routine",
        branch: "daily",
        title: "Time & Daily Routine",
        title_jp: "時/日/〜ます",
        icon: "🕰️",
        grammar_ids: &[
            "g3_masu_verbs",
            "g4_mashita_past",
            "g4_deshita_past",
            "g6_te_sequence",
            "g7_te_iru_wearing",
            "g7_describing_people",
            "g7_te_iru_ongoing",
            "g7_counting_people",
            "g9_mada_te_imasen",
            "g9_verb_modify",
        ],
        cando_ids: &["l4_past", "c6_then", "c7_wearing", "c7_looks", "c7_doing", "c7_family", "c9_not_yet", "c9_verb_noun"],
    },
    SkillSpec {
        node_id: "daily_desires",
        branch: "daily",
        title: "Desires & Experiences",
        title_jp: "〜たいです",
        icon: "✨",
        grammar_ids: &["g11_tai", "g11_tari", "g11_koto_ga_aru", "g11_ya"],
        cando_ids: &["c11_want", "c11_tari", "c11_ever"],
    },
    SkillSpec {
        node_id: "daily_plans",
        branch: "daily",
        title: "Plans & Intentions",
        title_jp: "〜つもりです",
        icon: "🎯",
        grammar_ids: &["g10_tsumori", "g10_naru", "g12_n_desu", "g12_sugiru", "g12_hou_ga_ii", "g12_node", "g12_nakereba"],
        cando_ids: &["c10_plan", "c10_become", "c12_explain", "c12_too_much", "c12_advice", "c12_probably"],
    },
];

/// Passively checks the player's spoken line against ALL curriculum lessons and grammar
/// to unlock or level up nodes on the Genki RPG Skill Tree, regardless of current lesson_idx.
#[allow(clippy::too_many_arguments)]
pub fn update_skill_tree(
    story: &Story,
    state: &mut RunState,
    input: &str,
    grammar_used: &[String],
    candos_done_this_turn: &[String],
    understood: bool,
    verdict: &str,
    pron_score: Option<u32>,
) -> Option<UnlockedSkill> {
    if !understood || input.trim().is_empty() {
        return None;
    }

    // Also match against any Can-Do across ALL lessons (0..=12), even future chapters!
    let kana = to_hiragana(&input.to_lowercase());
    let latin = latin_words(input);
    let mut matched_candos: BTreeSet<String> = candos_done_this_turn.iter().cloned().collect();
    for lesson in &story.lessons {
        for c in &lesson.candos {
            let (k, l) = without_ignored(&c.ignore, &kana, &latin);
            if c.match_all.iter().all(|group| group.iter().any(|f| form_matches(f, &k, &l))) {
                matched_candos.insert(c.id.clone());
            }
        }
    }

    let place = state.place(story).clone();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let mut newly_unlocked: Option<UnlockedSkill> = None;
    let mut leveled_up: Option<UnlockedSkill> = None;

    for spec in SKILL_SPECS {
        let hit_grammar = grammar_used.iter().any(|g| spec.grammar_ids.contains(&g.as_str()));
        let hit_cando = matched_candos.iter().any(|c| spec.cando_ids.contains(&c.as_str()));
        if !hit_grammar && !hit_cando {
            continue;
        }

        if let Some(existing) = state.unlocked_skills.get_mut(spec.node_id) {
            existing.uses += 1;
            existing.segments_used.insert(state.segment);
            let new_level = (existing.segments_used.len() as u8).clamp(1, 3);
            let did_level = new_level > existing.mastery_level;
            existing.mastery_level = new_level;

            // Update spoken trophy if this utterance had a higher pronunciation score or none was recorded yet.
            let better_pron = match (pron_score, existing.pron_score) {
                (Some(new_p), Some(old_p)) => new_p >= old_p,
                (Some(_), None) => true,
                _ => false,
            };
            if better_pron || existing.sentence.is_empty() {
                existing.sentence = input.to_string();
                if pron_score.is_some() {
                    existing.pron_score = pron_score;
                }
                existing.verdict = verdict.to_string();
                existing.place_id = place.id.clone();
                existing.place_name = place.name.clone();
                existing.timestamp = now;
            }
            if did_level && leveled_up.is_none() {
                leveled_up = Some(existing.clone());
            }
        } else {
            let mut segments_used = BTreeSet::new();
            segments_used.insert(state.segment);
            let skill = UnlockedSkill {
                node_id: spec.node_id.to_string(),
                branch: spec.branch.to_string(),
                title: spec.title.to_string(),
                title_jp: spec.title_jp.to_string(),
                icon: spec.icon.to_string(),
                sentence: input.to_string(),
                pron_score,
                verdict: verdict.to_string(),
                place_id: place.id.clone(),
                place_name: place.name.clone(),
                timestamp: now,
                mastery_level: 1,
                uses: 1,
                segments_used,
            };
            state.unlocked_skills.insert(spec.node_id.to_string(), skill.clone());
            if newly_unlocked.is_none() {
                newly_unlocked = Some(skill);
            }
        }
    }

    newly_unlocked.or(leveled_up)
}

/// Key words from this place that just turned up in characters' lines and
/// the player hasn't looked up yet: they get a dotted outline.
pub fn note_seen_words(story: &Story, state: &mut RunState, beats: &[Beat]) {
    let place = state.place(story).clone();
    for w in &place.pack {
        if state.known_words.contains_key(&w.jp) {
            continue;
        }
        if beats.iter().any(|b| b.speaker != PLAYER && !b.jp.is_empty() && b.jp.contains(&w.jp)) {
            state.seen_words.insert(w.jp.clone());
        }
    }
}


/// Normalises raw player input (speech-to-text or typed).
pub fn clean_input(raw: &str) -> Option<String> {
    let s: String = raw.chars().filter(|c| !c.is_control()).collect();
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    Some(s.chars().take(MAX_INPUT_CHARS).collect())
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::director::{Coach, StateChange, TrustChange};
    use crate::story::Verdict;

    fn story() -> Story {
        Story::load(std::path::Path::new("content/courses/ja/story.toml")).expect("story.toml is valid")
    }

    fn turn(complete: bool, grammar: &[&str], go_to: &str) -> DirectorTurn {
        DirectorTurn {
            coach: Coach {
                verdict: Verdict::Good,
                note: String::new(),
                better_jp: String::new(),
                better_romaji: String::new(),
                better_en: String::new(),
            },
            grammar_used: grammar.iter().map(|s| s.to_string()).collect(),
            beats: vec![Beat { jp: "はい".into(), ..Beat::player("") }.with_speaker("kenji")],
            choices: vec![],
            state: StateChange { yen_delta: 0, items_gained: vec![], items_lost: vec![], trust: vec![] },
            new_phrases: vec![],
            objective_complete: complete,
            go_to: go_to.into(),
            flags_set: vec![],
            journal: String::new(),
        }
    }

    impl Beat {
        fn with_speaker(mut self, s: &str) -> Self {
            self.speaker = s.into();
            self
        }
    }

    #[test]
    fn a_new_run_starts_in_the_arrivals_hall_with_kenji() {
        let story = story();
        let (s, intro) = RunState::new(&story, "Ren".into());
        assert_eq!(s.place, "arrivals_hall");
        assert!(!intro.is_empty());
        assert_eq!(s.on_stage, vec!["kenji".to_string()]);
        assert_eq!(s.lesson_idx, 0);
    }

    #[test]
    fn following_kenji_leads_to_the_police_box_not_somewhere_else() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        let out = apply_turn(&story, &mut s, turn(true, &["g0_daijoubu"], "koban"), InputVia::Voice, "");
        assert_eq!(out.go_to.as_deref(), Some("koban"));
        let intro = s.enter_place(&story, "koban");
        assert_eq!(s.place, "koban");
        assert_eq!(s.scene, "koban");
        assert!(intro.iter().any(|b| b.speaker == "yumi"), "Officer Sato greets you");
        assert!(!intro.iter().any(|b| b.speaker == "aiko"), "no jump to the Aiko scene");
    }

    #[test]
    fn the_director_cannot_teleport_the_player() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        // Not an exit from the arrivals hall.
        let out = apply_turn(&story, &mut s, turn(false, &[], "hostel_lobby"), InputVia::Voice, "");
        assert!(out.go_to.is_none());
        // An exit, but the job interview waits for Genki 6.
        s.flags.insert("job_lead".into());
        s.enter_place(&story, "asakusa_street");
        let out = apply_turn(&story, &mut s, turn(false, &[], "izakaya"), InputVia::Voice, "");
        assert!(out.go_to.is_none());
        let izakaya = s.exits(&story).into_iter().find(|e| e.to == "izakaya").unwrap();
        assert!(!izakaya.open);
        assert!(izakaya.locked_reason.unwrap().contains("Lesson 6"));
    }

    #[test]
    fn where_people_send_you_on_the_main_route_is_always_open() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "koban");
        assert!(s.can_go(&story, "airport_station"), "Officer Sato points to the station");
        let out = apply_turn(&story, &mut s, turn(false, &[], "airport_station"), InputVia::Voice, "");
        assert_eq!(out.go_to.as_deref(), Some("airport_station"));
        // Getting a ticket as an on-screen event opens the gates.
        s.enter_place(&story, "airport_station");
        let mut t = turn(false, &[], "stay");
        t.flags_set = vec!["has_ticket".into()];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert!(s.can_go(&story, "train_to_ueno"));
    }

    #[test]
    fn characters_never_parrot_the_player() {
        assert!(echoes("Thank you! I think this donut is better than the sausage. Please don't", "Thank you! I think this donut is better than the sausage. Please dont laugh, I am messy!"));
        assert!(echoes("すみません、かばんがありません！", "すみません かばんが ありません"));
        // Repeating one word back to check it is natural.
        assert!(!echoes("Bag?", "My bag is gone"));
        assert!(!echoes("かばん？", "かばんがありません"));
    }

    #[test]
    fn the_most_specific_place_name_wins() {
        let story = Story::load(std::path::Path::new("content/courses/en/story.toml")).expect("en story is valid");
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "hostel_lobby_nyc");
        s.flags.extend(["has_bed".to_string(), "has_job".to_string()]);
        assert_eq!(intended_exit(&story, &s, "I'm going to Mr. Russo's room").as_deref(), Some("russo_room"));
        assert_eq!(intended_exit(&story, &s, "ルッソさんのへやにいきます").as_deref(), Some("russo_room"));
        assert_eq!(intended_exit(&story, &s, "I'm going to my room to sleep").as_deref(), Some("hostel_room_nyc"));
    }

    #[test]
    fn saying_where_you_are_going_takes_you_there() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "koban");
        assert_eq!(intended_exit(&story, &s, "はい、えきへいきます！").as_deref(), Some("airport_station"));
        assert_eq!(intended_exit(&story, &s, "okay, I'll go to the station now").as_deref(), Some("airport_station"));
        assert_eq!(intended_exit(&story, &s, "駅に行きます").as_deref(), Some("airport_station"));
        // Mentioning a place without going, or a place that isn't an exit, does nothing.
        assert_eq!(intended_exit(&story, &s, "えきはどこですか？"), None);
        assert_eq!(intended_exit(&story, &s, "I'll go to the hostel"), None);
        // Asking the fare, or asking someone to repeat, isn't leaving.
        s.enter_place(&story, "airport_station");
        s.flags.insert("has_ticket".into());
        assert_eq!(intended_exit(&story, &s, "うえのまで、いくらですか"), None);
        assert_eq!(intended_exit(&story, &s, "でんしゃ…もういちどいってください"), None);
        assert_eq!(intended_exit(&story, &s, "でんしゃでうえのへいきます").as_deref(), Some("train_to_ueno"));
    }

    #[test]
    fn lessons_advance_when_their_can_dos_are_said_and_understood() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        let line = "だいじょうぶです。すみません、ありがとう。わかりません。";
        // Picking a suggested reply never counts…
        let out = apply_turn(&story, &mut s, turn(false, &[], "stay"), InputVia::Choice, line);
        assert!(out.candos_done.is_empty());
        // …and neither does a line the listener didn't understand.
        let mut t = turn(false, &[], "stay");
        t.coach.verdict = Verdict::NotUnderstood;
        assert!(apply_turn(&story, &mut s, t, InputVia::Voice, line).candos_done.is_empty());
        // Said and understood: all four of lesson 0's goals, and the lesson completes.
        let out = apply_turn(&story, &mut s, turn(false, &[], "stay"), InputVia::Voice, line);
        assert_eq!(out.candos_done.len(), 4);
        assert_eq!(out.lesson_complete, Some(0));
        assert_eq!(s.lesson_idx, 1);
    }

    #[test]
    fn can_do_ignore_lists_drop_look_alikes_only() {
        let story = story();
        let (mut state, _) = RunState::new(&story, "Ren".into());
        state.lesson_idx = 11;
        let said = |state: &mut RunState, text: &str| check_candos(&story, state, text, true).contains(&"c11_want".to_string());
        assert!(!said(&mut state, "あたまがいたいです"));
        assert!(!said(&mut state, "atama ga itai desu"));
        assert!(said(&mut state.clone(), "あたまがいたいです。うちにかえりたいです"));
        assert!(said(&mut state.clone(), "かばんをかいたいです"));
        assert!(said(&mut state, "kaeritai desu"));
    }

    #[test]
    fn can_do_matching_accepts_kana_kanji_romaji_and_loanwords() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.lesson_idx = 2;
        assert_eq!(check_candos(&story, &mut s, "パスポートを盗まれました", true), vec!["l2_lost"]);
        assert_eq!(check_candos(&story, &mut s, "watashi no ja arimasen", true), vec!["l2_not_mine"]);
        assert_eq!(check_candos(&story, &mut s, "my name... amerikajin desu", true), vec!["l1_from"]);
        // "ue" inside "Ueno" isn't "on top of"; nothing here matches a location word.
        assert!(check_candos(&story, &mut s, "almost", true).is_empty());
    }

    #[test]
    fn goals_set_flags_rewards_and_unlock_exits() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "koban");
        let mut t = turn(true, &[], "stay");
        t.state.yen_delta = 50_000; // clamped to the kōban's ¥1,000
        t.state.trust = vec![TrustChange { character: "yumi".into(), delta: 9 }];
        let out = apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert!(out.goal_complete.is_some());
        assert!(s.flags.contains("reported_theft"));
        assert_eq!(s.yen, 1000);
        assert!(s.items.contains(&"theft_report".to_string()));
        assert_eq!(s.trust["yumi"], TRUST_STEP);
        // The goal can't pay out twice.
        let again = apply_turn(&story, &mut s, turn(true, &[], "stay"), InputVia::Voice, "");
        assert!(again.goal_complete.is_none());
        assert_eq!(s.yen, 1000);
    }

    #[test]
    fn flag_locked_exits_open_when_the_story_gets_there() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.lesson_idx = 3;
        s.enter_place(&story, "ueno_street");
        assert!(s.flags.contains("reached_tokyo"), "on-enter flag");
        assert!(!s.can_go(&story, "hostel_lobby"));
        let mut t = turn(false, &[], "stay");
        t.flags_set = vec!["knows_hostel".into(), "ending_home".into()]; // the second isn't this place's
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert!(s.can_go(&story, "hostel_lobby"));
        assert!(!s.flags.contains("ending_home"));
    }

    #[test]
    fn triggers_fire_once_and_endings_finish_the_run() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.flags.insert("paid_rent".into());
        s.lesson_idx = 6;
        assert!(run_triggers(&story, &mut s).is_empty(), "needs Genki 7");
        s.lesson_idx = 7;
        assert_eq!(run_triggers(&story, &mut s).len(), 1);
        assert!(s.flags.contains("bag_found"));
        assert!(run_triggers(&story, &mut s).is_empty());

        s.flags.insert("ending_stay".into());
        let beats = check_ending(&story, &mut s).expect("ending");
        assert!(!beats.is_empty());
        assert_eq!(s.status, RunStatus::Complete);
        assert_eq!(s.ending.as_deref(), Some("ending_stay"));
    }

    #[test]
    fn the_big_goal_is_the_first_unmet_quest() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        assert_eq!(s.current_quest(&story).unwrap().id, "escape");
        s.flags.insert("reached_tokyo".into());
        assert_eq!(s.current_quest(&story).unwrap().id, "bed");
    }

    #[test]
    fn words_are_owned_after_spaced_use() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        let w = |romaji: &str, en: &str, kind: &str| KnownWord {
            romaji: romaji.into(), en: en.into(), kind: kind.into(), note: String::new(), mastered: false,
            uses: 0, last_use_segment: 0,
        };
        s.known_words.insert("かばん".into(), w("kaban", "bag", "noun"));
        s.known_words.insert("大丈夫ですか".into(), w("daijōbu desu ka", "are you okay", "adjective"));
        s.known_words.insert("は".into(), w("wa", "topic marker", "particle"));

        // Katakana from speech-to-text still counts; particles never "master".
        let (used, owned) = record_word_uses(&mut s, "カバンはないです");
        assert_eq!(used.len(), 1);
        assert!(owned.is_empty(), "one use isn't ownership");
        assert_eq!(s.known_words["かばん"].uses, 1);
        assert_eq!(s.known_words["は"].uses, 0, "particles aren't counted");
        // A word counts once per visit…
        assert!(record_word_uses(&mut s, "かばん！").0.is_empty());
        // …and is owned after OWN_AFTER separate visits.
        for _ in 1..OWN_AFTER {
            s.segment += 1;
            record_word_uses(&mut s, "かばん");
        }
        assert!(s.known_words["かばん"].mastered);

        // Endings don't block a match (大丈夫ですか ≈ "daijoubu desu").
        assert_eq!(record_word_uses(&mut s, "daijoubu desu").0.len(), 1);
    }

    #[test]
    fn director_message_carries_place_exits_and_player_words() {
        let story = story();
        let (s, intro) = RunState::new(&story, "Ren".into());
        let msg = director_message(&story, &s, &intro, Prompt::Turn { input: "だいじょうぶです", via: InputVia::Voice });
        assert!(msg.contains("<player_said via=\"voice\">だいじょうぶです</player_said>"));
        assert!(msg.contains("`koban` — The police box Kenji points to, just outside [OPEN]"));
        assert!(msg.contains("I have to get out of this airport"));
        let arrival = director_message(&story, &s, &[], Prompt::Arrival { from: Some("koban") });
        assert!(arrival.contains("<arrival from=\"The Kōban\"/>"));
    }

    #[test]
    fn scene_score_rewards_clamp_battery_and_boost_cast_trust_on_s_rank() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "koban");
        s.battery = 40;

        // C-Rank: +0% battery, no trust change
        let (bat_c, trust_c) = s.apply_scene_reward(&story, "koban", "C");
        assert_eq!(bat_c, 0);
        assert!(trust_c.is_empty());
        assert_eq!(s.battery, 40);

        // B-Rank: +10% battery
        let (bat_b, _) = s.apply_scene_reward(&story, "koban", "B");
        assert_eq!(bat_b, 10);
        assert_eq!(s.battery, 50);

        // A-Rank: +20% battery
        let (bat_a, _) = s.apply_scene_reward(&story, "koban", "A");
        assert_eq!(bat_a, 20);
        assert_eq!(s.battery, 70);

        // S-Rank: +30% battery (clamped at 100%) and +1 trust for cast in koban
        s.battery = 85;
        let (bat_s, trust_s) = s.apply_scene_reward(&story, "koban", "S");
        assert_eq!(bat_s, 15);
        assert_eq!(s.battery, 100);
        assert!(!trust_s.is_empty());
        assert_eq!(s.trust["yumi"], 1);
    }
}
