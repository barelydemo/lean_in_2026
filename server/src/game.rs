//! Game rules for the open world. The director proposes; this module
//! disposes. Every change it suggests is validated against the current
//! place's rules before it touches the save. The player moves between
//! places through exits; the curriculum is their own progress track, and
//! lessons complete through "I can…" goals checked against what the player
//! actually says.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::director::{Difficulty, DirectorTurn};
use crate::story::{Action, Ambient, Beat, EXTRA, Exit, Lesson, NARRATOR, PLAYER, Phrase, Place, Quest, Story, THOUGHT, TOWNSFOLK_PREFIX, is_inner};

pub const MAX_BEATS_PER_TURN: usize = 5;
pub const TRANSCRIPT_LINES: usize = 40;
/// Turns in one place after which a story scene lets the player leave anyway,
/// so an unfinished goal never traps anyone.
pub const ROAM_AFTER: u32 = 10;
/// Lines remembered per visit for the no-repeats rule.
const SAID_HERE_MAX: usize = 60;
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
    /// Patience left for each character in this scene (see CastMember::patience).
    #[serde(default)]
    pub patience: BTreeMap<String, i64>,
    /// Turns until this scene's timer fires, if it has one.
    #[serde(default)]
    pub timer_left: Option<u32>,
    /// Why this scene ran its course: "patience" or "timer".
    #[serde(default)]
    pub scene_over: Option<String>,
    /// The level the player last played a turn at.
    #[serde(default)]
    pub difficulty: Difficulty,
    /// The player's latest thought about what to try next (from the director).
    #[serde(default)]
    pub lead: String,
    /// Scene visits (segments) that already paid a scorecard reward.
    #[serde(default)]
    pub rewarded_segments: BTreeSet<usize>,
    /// People here who have talked with the player this visit. Only their
    /// patience runs down: someone you haven't approached isn't waiting on you.
    #[serde(default)]
    pub engaged: BTreeSet<String>,
    /// Who the player is talking with right now ("" when nobody).
    #[serde(default)]
    pub talking_to: String,
    /// Lines said in this visit (characters' words, narration, thoughts), to
    /// keep anyone from saying the same thing twice.
    #[serde(default)]
    pub said_here: Vec<String>,
    /// Exits the conversation here has pointed the player to (a suggested
    /// reply heads there): their "Go →" opens even mid-scene.
    #[serde(default)]
    pub pointed: BTreeSet<String>,
    /// What has happened to the player, written by the game (never the
    /// director) whenever the world changes: the episodic memory.
    #[serde(default)]
    pub episodes: Vec<Episode>,
    /// Repeatable events already done during this visit.
    #[serde(default)]
    pub done_this_visit: BTreeSet<String>,
    /// Story-graph steps done, as "quest/step" (once done, they stay done).
    #[serde(default)]
    pub steps_done: BTreeSet<String>,
    /// Places characters have told the player about, anywhere, ever: once
    /// told, the way there opens wherever it can (Aiko named the guesthouse
    /// at the konbini; the street can take you there later).
    #[serde(default)]
    pub heard_of: BTreeSet<String>,
    /// The player has been to this place before this visit.
    #[serde(default)]
    pub revisit: bool,
    /// What each person remembers about the player, oldest first.
    #[serde(default)]
    pub memories: BTreeMap<String, Vec<String>>,
    pub ending: Option<String>,
}

/// The current objective from the story graph, for the HUD and popups.
#[derive(Debug, Clone, Serialize)]
pub struct ObjectiveView {
    pub quest: String,
    /// "quest/step": changes when a step is done.
    pub step_id: String,
    pub step: String,
    /// Why it matters, in the player's words.
    pub why: String,
    /// How far along, when it can be counted ("¥1,000 of ¥1,270 — ¥270 short").
    pub progress: String,
    /// Ways open where the player is now.
    pub here: Vec<String>,
    /// Ways open elsewhere: (way, place name).
    pub elsewhere: Vec<(String, String)>,
}

/// The story graph as the player has lived it, for the flowchart screen.
#[derive(Debug, Clone, Serialize)]
pub struct FlowQuest {
    pub title: String,
    /// "done", "active" or "locked" (not reached yet: its title stays hidden).
    pub status: &'static str,
    pub steps: Vec<FlowStep>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FlowStep {
    pub title: String,
    /// "done" or "todo".
    pub status: &'static str,
    pub branches: Vec<FlowBranch>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FlowBranch {
    pub label: String,
    /// The place's name once visited, otherwise "".
    pub at: String,
    /// "taken", "open" (possible now), "closed" (the step was done another
    /// way) or "locked" (not possible yet).
    pub status: &'static str,
}

/// A place's goal is done: its rewards (shown as the game's own line), the
/// log, the story graph, and the journal page.
pub fn finish_goal(story: &Story, state: &mut RunState, place: &Place, journal: &str, next_steps: &[String], beats: &mut Vec<Beat>) -> GoalComplete {
    state.goals_done.insert(place.id.clone());
    state.yen += place.reward_yen;
    state.place_yen_gained += place.reward_yen;
    let new_items: Vec<String> = place.reward_items.iter().filter(|i| !state.items.contains(*i)).cloned().collect();
    state.items.extend(new_items.iter().cloned());
    if let Some(line) = change_line(story, place.reward_yen, &new_items) {
        beats.push(Beat::narration(&line));
    }
    state.log(&place.name, format!("Scene goal done: {}", place.goal));
    state.update_steps(story);
    state.battery = (state.battery + place.recharge).min(100);
    let journal = if journal.trim().is_empty() { format!("{} — I did it, one word at a time.", place.name) } else { journal.to_string() };
    let next_steps = next_steps.iter().map(|s| s.trim().chars().take(100).collect::<String>()).filter(|s| !s.is_empty()).take(3).collect();
    GoalComplete { place: place.id.clone(), journal, next_steps }
}

/// Walking out of a scene whose goal is only described in words, after
/// talking with someone, finishes it: they got what they came for (Kenji
/// pointed the way and they went). Goals made of facts never finish this way.
pub fn finish_on_leaving(story: &Story, state: &mut RunState, beats: &mut Vec<Beat>) -> Option<GoalComplete> {
    let place = state.place(story).clone();
    if place.goal_flags.is_empty() && !place.success.trim().is_empty() && !state.engaged.is_empty() && !state.goals_done.contains(&place.id) {
        return Some(finish_goal(story, state, &place, "", &[], beats));
    }
    None
}

/// The game's own line for a change it made: "+¥1,000 · Theft report".
pub fn change_line(story: &Story, money: i64, items: &[String]) -> Option<String> {
    let cur = &story.course.currency;
    let mut parts = Vec::new();
    if money > 0 {
        parts.push(format!("+{cur}{}", group(money)));
    } else if money < 0 {
        parts.push(format!("−{cur}{}", group(-money)));
    }
    parts.extend(items.iter().filter_map(|i| story.items.iter().find(|x| &x.id == i)).map(|x| format!("{} {}", x.icon, x.name)));
    (!parts.is_empty()).then(|| parts.join(" · "))
}

fn group(n: i64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// One thing that happened to the player, in plain words.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    pub place: String,
    pub text: String,
}

/// Episodes the director sees each turn.
const STORY_SO_FAR: usize = 20;
/// Episodes kept: the director sees the latest; old ones are a long way back.
const EPISODES_MAX: usize = 80;

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
            rewarded_segments: BTreeSet::new(),
            lead: String::new(),
            difficulty: Difficulty::default(),
            patience: BTreeMap::new(),
            timer_left: None,
            scene_over: None,
            engaged: BTreeSet::new(),
            talking_to: String::new(),
            memories: BTreeMap::new(),
            revisit: false,
            said_here: Vec::new(),
            pointed: BTreeSet::new(),
            heard_of: BTreeSet::new(),
            episodes: Vec::new(),
            done_this_visit: BTreeSet::new(),
            steps_done: BTreeSet::new(),
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
        self.revisit = !first_visit;
        self.place = place.id.clone();
        self.segment += 1;
        self.place_turns = 0;
        self.place_yen_gained = 0;
        self.place_yen_spent = 0;
        self.scene = place.scene.clone();
        self.on_stage.clear();
        self.choices = place.choices.clone();
        self.choices_unlocked = false;
        self.patience = if place.unhurried {
            BTreeMap::new()
        } else {
            place.cast.iter().filter_map(|id| story.cast_member(id)).map(|c| (c.id.clone(), c.patience)).collect()
        };
        self.timer_left = place.timer.as_ref().map(|t| t.turns);
        self.scene_over = None;
        self.lead.clear();
        self.engaged.clear();
        self.talking_to.clear();
        self.said_here.clear();
        self.pointed.clear();
        self.done_this_visit.clear();
        if first_visit {
            self.log(&place.name, format!("Arrived at {} for the first time.", place.name));
        }
        self.open_heard_ways(story);
        for f in &place.on_enter_flags {
            self.flags.insert(f.clone());
        }
        self.update_steps(story);
        let mut intro = if first_visit { place.intro.clone() } else { Vec::new() };
        // Everyone who lives here is visible by the end of the intro, even if
        // the script never brings them on: the player can walk up to them.
        if let Some(last) = intro.last_mut() {
            let mentioned = |id: &String| place.intro.iter().any(|b| &b.speaker == id || b.enter.contains(id));
            last.enter.extend(place.cast.iter().filter(|c| !mentioned(c)).cloned());
        }
        for b in &intro {
            self.track_stage(b);
        }
        intro
    }

    fn said_text(b: &Beat) -> &str {
        if is_inner(&b.speaker) { &b.en } else { &b.jp }
    }

    /// Is this beat a near-copy of something already said in this visit?
    /// Short lines (はい, a nod) may come round again.
    fn repeats(&self, b: &Beat) -> bool {
        let text = Self::said_text(b);
        squash(text).chars().count() >= 8 && self.said_here.iter().any(|s| echoes(s, text))
    }

    fn note_said(&mut self, b: &Beat) {
        let text = Self::said_text(b);
        if !text.is_empty() {
            self.said_here.push(text.to_string());
            if self.said_here.len() > SAID_HERE_MAX {
                self.said_here.remove(0);
            }
        }
    }

    /// Below Advanced, every reply ends with the player working out what's
    /// going on, so they always know what they could do next: the director's
    /// own thought if it wrote one, otherwise its `lead`.
    pub fn think(&mut self, story: &Story, beats: &mut Vec<Beat>, lead: &str) {
        // "I'm ¥270 short" once the player has the money (or before anyone
        // has told them a price) is out of date: it isn't thought or narrated.
        let stale = |t: &str| claims_short(t) && !self.really_short(story);
        beats.retain(|b| !(matches!(b.speaker.as_str(), THOUGHT | NARRATOR) && stale(&b.en)));
        let lead = if stale(lead) { "" } else { lead };
        if self.difficulty == Difficulty::Advanced || beats.iter().any(|b| b.speaker == THOUGHT) {
            return;
        }
        let thought = Beat { speaker: THOUGHT.into(), ..Beat::narration(lead.trim()) };
        if thought.en.is_empty() || self.repeats(&thought) {
            return;
        }
        self.note_said(&thought);
        beats.push(thought);
    }

    /// The current objective is a sum the player doesn't have yet.
    fn really_short(&self, story: &Story) -> bool {
        self.current_quest(story)
            .and_then(|q| q.steps.iter().find(|st| !self.steps_done.contains(&Self::step_key(q, st))))
            .is_some_and(|st| st.done_min_yen > self.yen)
    }

    /// Exits to places the player has been told about: their button shows,
    /// and a story flag that only stood for "knows the way" — one this place
    /// can give — is set.
    pub fn open_heard_ways(&mut self, story: &Story) {
        let place = self.place(story).clone();
        let told = &story.course.told_flags;
        let settable = |f: &String| told.contains(f) && (place.goal_flags.contains(f) || place.events.iter().any(|ev| &ev.flag == f));
        for e in place.exits.iter().filter(|e| self.heard_of.contains(&e.to)) {
            self.pointed.insert(e.to.clone());
            if e.requires_flags.iter().all(settable) {
                self.flags.extend(e.requires_flags.iter().cloned());
            }
        }
    }

    pub fn log(&mut self, place: &str, text: String) {
        self.episodes.push(Episode { place: place.to_string(), text });
        if self.episodes.len() > EPISODES_MAX {
            self.episodes.remove(0);
        }
    }

    fn step_key(q: &Quest, st: &crate::story::QuestStep) -> String {
        format!("{}/{}", q.id, st.id)
    }

    fn step_met(&self, st: &crate::story::QuestStep) -> bool {
        st.done_any.iter().any(|f| self.flags.contains(f)) || (st.done_min_yen > 0 && self.yen >= st.done_min_yen)
    }

    /// Marks newly finished story-graph steps (they stay done) and logs them.
    pub fn update_steps(&mut self, story: &Story) {
        for q in &story.quests {
            for st in &q.steps {
                let key = Self::step_key(q, st);
                if !self.steps_done.contains(&key) && self.step_met(st) {
                    self.steps_done.insert(key);
                    let how = st.branches.iter().find(|b| self.flags.contains(&b.flag)).map(|b| format!(" ({})", b.label)).unwrap_or_default();
                    let place = self.place.clone();
                    self.log(&place, format!("Done: {}{how}.", st.title));
                }
            }
        }
    }

    /// A way of doing a step that's already done another way: closed.
    pub fn closed_way(&self, story: &Story, flag: &str) -> bool {
        !self.flags.contains(flag)
            && story.quests.iter().any(|q| {
                q.steps.iter().any(|st| self.steps_done.contains(&Self::step_key(q, st)) && st.branches.iter().any(|b| b.flag == flag))
            })
    }

    /// Why this event can't happen right now, or `None` if it can.
    pub fn event_blocked(&self, story: &Story, e: &crate::story::PlaceEvent) -> Option<String> {
        if e.repeatable {
            if self.done_this_visit.contains(&e.flag) {
                return Some("already done this visit".into());
            }
        } else if self.flags.contains(&e.flag) {
            return Some("already happened".into());
        }
        if self.closed_way(story, &e.flag) {
            return Some("no longer needed: that step is already done another way".into());
        }
        if let Some(f) = e.requires_flags.iter().find(|f| !self.flags.contains(*f)) {
            return Some(format!("needs `{f}` first"));
        }
        if let Some(i) = e.requires_items.iter().find(|i| !self.items.contains(*i)) {
            let name = story.items.iter().find(|x| x.id == **i).map(|x| x.name.as_str()).unwrap_or(i.as_str());
            return Some(format!("the player needs {name}"));
        }
        if e.min_yen > 0 && self.yen < e.min_yen {
            return Some(format!("only if the player already has most of it ({}{} or more; they have {}{})", story.course.currency, e.min_yen, story.course.currency, self.yen));
        }
        if e.tops_up_to > 0 && self.yen >= e.tops_up_to {
            return Some("not needed: they already have enough".into());
        }
        if e.cost > 0 && self.yen < e.cost {
            return Some(format!("can't afford it: costs {c}{}, they have {c}{} (short {c}{})", e.cost, self.yen, e.cost - self.yen, c = story.course.currency));
        }
        None
    }

    /// Applies an event the code has allowed: money, items, facts, the log.
    fn apply_event(&mut self, story: &Story, place: &Place, e: &crate::story::PlaceEvent) -> Option<String> {
        let before = self.yen;
        self.yen -= e.cost;
        self.place_yen_spent += e.cost;
        let mut gain = e.gives_yen;
        if e.tops_up_to > 0 {
            gain = gain.min((e.tops_up_to - self.yen).max(0));
        }
        self.yen += gain;
        self.place_yen_gained += gain;
        for i in &e.takes_items {
            self.items.retain(|x| x != i);
        }
        for i in &e.gives_items {
            if !self.items.contains(i) {
                self.items.push(i.clone());
            }
        }
        self.flags.insert(e.flag.clone());
        self.flags.extend(e.sets_flags.iter().cloned());
        self.done_this_visit.insert(e.flag.clone());
        let what = if e.label.is_empty() { e.flag.replace('_', " ") } else { e.label.clone() };
        let money = if self.yen != before { format!(" Money: {}{} → {}{}.", story.course.currency, before, story.course.currency, self.yen) } else { String::new() };
        let got: Vec<&str> = e.gives_items.iter().filter_map(|i| story.items.iter().find(|x| &x.id == i)).map(|x| x.name.as_str()).collect();
        let got = if got.is_empty() { String::new() } else { format!(" Got: {}.", got.join(", ")) };
        self.log(&place.name, format!("{what}.{money}{got}"));
        change_line(story, self.yen - before, &e.gives_items)
    }

    /// Runs the events the director says happened this turn: each only if
    /// the rules allow it now. Goal facts that aren't events are set as is.
    /// Returns true if something was refused for lack of money.
    pub fn run_events(&mut self, story: &Story, place: &Place, flags: &[String], beats: &mut Vec<Beat>) -> bool {
        let mut short = false;
        // In the order the place declares them (half the rent, then the rest).
        // Nobody hands over money while they're still asking how much.
        let asking = beats
            .iter()
            .rev()
            .find(|b| !is_inner(&b.speaker) && b.speaker != PLAYER && b.speaker != NARRATOR)
            .is_some_and(|b| [&b.jp, &b.en].iter().any(|t| t.trim_end().ends_with(['?', '？'])));
        for e in place.events.iter().filter(|e| flags.contains(&e.flag)) {
            let only_money = e.gives_yen > 0 && e.gives_items.is_empty() && e.cost == 0 && e.heard.is_empty();
            if asking && only_money {
                continue;
            }
            match self.event_blocked(story, e) {
                None => {
                    // The game says what this means, so the director's own
                    // (longer) version of it from this character goes.
                    if let Some(who) = e.says.first().map(|l| l.who.clone()) {
                        beats.retain(|b| b.speaker != who || b.jp.chars().count() <= 16);
                    }
                    for l in &e.says {
                        beats.push(Beat { speaker: l.who.clone(), jp: l.jp.clone(), romaji: l.romaji.clone(), en: l.en.clone(), ..Beat::narration("") });
                    }
                    if let Some(line) = self.apply_event(story, place, e) {
                        beats.push(Beat::narration(&line));
                    }
                }
                Some(_) if e.cost > 0 && self.yen < e.cost => short = true,
                Some(_) => {}
            }
        }
        for f in flags.iter().filter(|f| place.goal_flags.contains(*f) && !place.events.iter().any(|e| &e.flag == *f)) {
            if !self.flags.contains(f) && !self.closed_way(story, f) {
                self.flags.insert(f.clone());
                self.log(&place.name, format!("{}.", f.replace('_', " ")));
            }
        }
        self.update_steps(story);
        short
    }

    /// The flowchart: done and current objectives in full, later ones hidden.
    pub fn flow(&self, story: &Story) -> Vec<FlowQuest> {
        let current = self.current_quest(story).map(|q| q.id.clone());
        let mut reached = true;
        story
            .quests
            .iter()
            .map(|q| {
                let done = q.flags_any.iter().any(|f| self.flags.contains(f));
                let status = if done { "done" } else if Some(&q.id) == current.as_ref() { "active" } else { "locked" };
                if status == "locked" {
                    reached = false;
                }
                let steps = if !reached && status == "locked" {
                    Vec::new()
                } else {
                    q.steps
                        .iter()
                        .map(|st| {
                            let step_done = self.steps_done.contains(&Self::step_key(q, st));
                            let branches = st
                                .branches
                                .iter()
                                .map(|b| {
                                    let event = story.place(&b.at).and_then(|p| p.events.iter().find(|e| e.flag == b.flag));
                                    let status = if self.flags.contains(&b.flag) {
                                        "taken"
                                    } else if step_done {
                                        "closed"
                                    } else if event.is_none_or(|e| self.event_blocked(story, e).is_none()) {
                                        "open"
                                    } else {
                                        "locked"
                                    };
                                    let at = if self.visited.contains(&b.at) { story.place(&b.at).map(|p| p.name.clone()).unwrap_or_default() } else { String::new() };
                                    FlowBranch { label: b.label.clone(), at, status }
                                })
                                .collect();
                            FlowStep { title: st.title.clone(), status: if step_done { "done" } else { "todo" }, branches }
                        })
                        .collect()
                };
                FlowQuest { title: if status == "locked" { String::new() } else { q.title.clone() }, status, steps }
            })
            .collect()
    }

    /// The episodic memory, latest last, for the director.
    pub fn story_so_far(&self, _story: &Story) -> String {
        let start = self.episodes.len().saturating_sub(STORY_SO_FAR);
        let lines: Vec<String> = self.episodes[start..].iter().map(|e| format!("- [{}] {}", e.place, e.text)).collect();
        if lines.is_empty() { "Nothing yet: the story is just beginning.".into() } else { lines.join("\n") }
    }

    /// Facts worked out by the game, so nobody has to do arithmetic: money,
    /// what the player carries, and what they can or can't afford nearby.
    pub fn facts(&self, story: &Story) -> String {
        let cur = &story.course.currency;
        let mut out = vec![format!("Money: {cur}{}.", self.yen)];
        let items: Vec<&str> = self.items.iter().filter_map(|i| story.items.iter().find(|x| &x.id == i)).map(|x| x.name.as_str()).collect();
        out.push(format!("Carrying: {}.", if items.is_empty() { "nothing".to_string() } else { items.join(", ") }));
        let here = self.place(story);
        let near: Vec<&Place> = std::iter::once(here).chain(here.exits.iter().filter_map(|e| story.place(&e.to))).collect();
        for p in near {
            for e in p.events.iter().filter(|e| e.cost > 0 && !e.repeatable && !self.flags.contains(&e.flag)) {
                if e.requires_flags.iter().any(|f| !self.flags.contains(f)) || self.closed_way(story, &e.flag) {
                    continue;
                }
                let what = if e.label.is_empty() { e.flag.replace('_', " ") } else { e.label.clone() };
                if !e.price_known_by.is_empty() && !self.flags.contains(&e.price_known_by) {
                    out.push(format!("{what} at {}: the PLAYER DOESN'T KNOW the price yet, so they can't know whether their money is enough (suggested replies ask, they don't assume).", p.name));
                    continue;
                }
                let verdict = if self.yen >= e.cost {
                    format!("CAN afford it (has {cur}{})", self.yen)
                } else {
                    format!("can't afford it yet: short {cur}{}", e.cost - self.yen)
                };
                out.push(format!("{what} costs {cur}{} at {}: {verdict}.", e.cost, p.name));
            }
        }
        out.join("\n")
    }

    /// The current objective from the story graph: the next step and the
    /// ways open to the player, here and elsewhere.
    pub fn objective(&self, story: &Story) -> Option<ObjectiveView> {
        let q = self.current_quest(story)?;
        let open = |b: &crate::story::Branch| -> bool {
            if self.flags.contains(&b.flag) {
                return false;
            }
            match story.place(&b.at).and_then(|p| p.events.iter().find(|e| e.flag == b.flag)) {
                Some(e) => self.event_blocked(story, e).is_none(),
                None => true,
            }
        };
        // Steps come in order: the next one is the first not yet done (one
        // done early, like a loan before knowing the fare, still counts), so
        // nothing is shown before the player could know it.
        let step = q.steps.iter().find(|st| !self.steps_done.contains(&Self::step_key(q, st)))?;
        let cur = &story.course.currency;
        let progress = if step.done_min_yen > self.yen {
            format!("{cur}{} of {cur}{} — {cur}{} short", group(self.yen), group(step.done_min_yen), group(step.done_min_yen - self.yen))
        } else {
            String::new()
        };
        Some(ObjectiveView {
            quest: q.title.clone(),
            step_id: Self::step_key(q, step),
            step: step.title.clone(),
            why: step.why.clone(),
            progress,
            here: step.branches.iter().filter(|b| b.at == self.place && open(b)).map(|b| b.label.clone()).collect(),
            elsewhere: step
                .branches
                .iter()
                .filter(|b| b.at != self.place && open(b))
                .filter_map(|b| story.place(&b.at).map(|p| (b.label.clone(), p.name.clone())))
                .collect(),
        })
    }

    /// The objective as the director reads it.
    pub fn objective_now(&self, story: &Story) -> String {
        let Some(q) = self.current_quest(story) else { return "The story's big goals are done: free roaming.".into() };
        let mut out = vec![format!("Big goal: {}", q.title)];
        let done: Vec<&str> = q.steps.iter().filter(|st| self.steps_done.contains(&Self::step_key(q, st))).map(|st| st.title.as_str()).collect();
        if !done.is_empty() {
            out.push(format!("Already done: {}.", done.join("; ")));
        }
        let Some(o) = self.objective(story) else { return out.join("\n") };
        out.push(format!("Next step: {}.{}", o.step, if o.why.is_empty() { String::new() } else { format!(" ({})", o.why) }));
        out.push(format!("Ways open HERE: {}.", if o.here.is_empty() { "none".to_string() } else { o.here.join("; ") }));
        if !o.elsewhere.is_empty() {
            let away: Vec<String> = o.elsewhere.iter().map(|(w, at)| format!("{w} — at {at}")).collect();
            out.push(format!("Ways open elsewhere: {}.", away.join("; ")));
        }
        out.push("Choice #1 moves this step forward: a line the player would say to do one of the ways open HERE, or, if none is here, to head toward one elsewhere. No choice may contradict the facts (e.g. claiming they can't afford something they can).".into());
        out.join("\n")
    }

    /// Does this character speak the player's own language right now?
    pub fn in_own_language(&self, story: &Story, id: &str) -> bool {
        story.cast_member(id).is_some_and(|c| {
            c.speaks_player_language && !c.own_language_except_near.iter().any(|o| self.on_stage.contains(o))
        })
    }

    /// People here who haven't left: the ones the player can walk up to.
    pub fn present(&self, story: &Story) -> Vec<String> {
        self.place(story)
            .cast
            .iter()
            .filter(|c| self.patience.get(*c).is_none_or(|left| *left > 0))
            .cloned()
            .collect()
    }

    /// Brings anyone here who isn't on stage yet into view with the first beat.
    pub fn stage_everyone(&mut self, story: &Story, beats: &mut [Beat]) {
        let missing: Vec<String> = self.present(story).into_iter().filter(|c| !self.on_stage.contains(c)).collect();
        if let Some(first) = beats.first_mut()
            && !missing.is_empty()
        {
            for c in missing {
                if !first.enter.contains(&c) {
                    first.enter.push(c.clone());
                }
                self.on_stage.push(c);
            }
        }
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
        for c in &b.enter {
            if !self.on_stage.contains(c) {
                self.on_stage.push(c.clone());
            }
        }
        let is_cast = !is_inner(&b.speaker) && b.speaker != EXTRA && b.speaker != PLAYER;
        if !is_cast {
            return;
        }
        // One passer-by on stage at a time: the next stranger replaces the last.
        if b.speaker.starts_with(TOWNSFOLK_PREFIX) {
            self.on_stage.retain(|c| !c.starts_with(TOWNSFOLK_PREFIX) || c == &b.speaker);
        } else if !b.jp.is_empty() {
            self.engaged.insert(b.speaker.clone());
            self.talking_to = b.speaker.clone();
        }
        match b.action {
            Action::ExitLeft | Action::ExitRight => self.on_stage.retain(|c| c != &b.speaker),
            _ if !self.on_stage.contains(&b.speaker) => self.on_stage.push(b.speaker.clone()),
            _ => {}
        }
    }

    /// A story scene: this place's goal isn't done yet, so the way on stays
    /// closed until it is. Places without a goal, finished ones, scenes that
    /// ran their course and long stays are free roaming.
    pub fn in_story_scene(&self, story: &Story) -> bool {
        let place = self.place(story);
        // Only once a conversation is under way: walking in and looking
        // around never holds anyone.
        self.status == RunStatus::Playing
            && !self.engaged.is_empty()
            && !place.success.trim().is_empty()
            && !(!place.goal_flags.is_empty() && place.goal_flags.iter().all(|f| self.closed_way(story, f)))
            && !self.goals_done.contains(&place.id)
            && self.scene_over.is_none()
            && self.place_turns < ROAM_AFTER
    }

    /// Why an exit is closed, or `None` if it's open.
    pub fn exit_locked_reason(&self, story: &Story, e: &Exit) -> Option<String> {
        // A story scene keeps its shortcuts (buttons, map) closed, except
        // where someone has pointed the player, or a door that's right there.
        if self.in_story_scene(story) && !e.open_in_scene && !self.pointed.contains(&e.to) {
            return Some(story.course.locked_story.clone());
        }
        self.world_locked_reason(story, e)
    }

    /// What the world itself says about an exit: lessons and story flags.
    /// Saying where you're going in the conversation only has to pass this.
    fn world_locked_reason(&self, story: &Story, e: &Exit) -> Option<String> {
        // Reached in the curriculum, or already shown by speaking that lesson's
        // grammar out loud (the skill tree awakens nodes ahead of the lesson).
        let shown = self.unlocked_skills.contains_key(&lesson_node_id(e.min_lesson));
        if self.lesson_idx < e.min_lesson && !shown {
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

    /// Walking off in the story itself ("I'm going to the police box"):
    /// a story scene never stops a player who says where they're going.
    pub fn can_walk(&self, story: &Story, to: &str) -> bool {
        self.place(story).exits.iter().any(|e| e.to == to && self.world_locked_reason(story, e).is_none())
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
    /// What the player could do next toward their big goal.
    pub next_steps: Vec<String>,
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
    /// Characters whose patience ran out this turn.
    pub departed: Vec<String>,
    /// Story-graph steps finished this turn: a scene ends on each.
    pub steps_done: Vec<String>,
    /// Set when the scene ran its course this turn ("patience" / "timer").
    pub scene_over: Option<String>,
}

/// The mode of a director call.
pub enum Prompt<'a> {
    Turn { input: &'a str, via: InputVia },
    /// The player just walked in from `from` (None on the very first scene).
    Arrival { from: Option<&'a str> },
    /// The player walks up to someone here to start talking.
    Approach { who: &'a str },
    /// The player takes a moment to look around and think.
    Look,
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
            THOUGHT => format!("{} (thinking)", state.player_name),
            PLAYER => format!("{} (player)", state.player_name),
            EXTRA => b.speaker_name.clone(),
            _ if !b.speaker_name.is_empty() => b.speaker_name.clone(),
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
    // Who's here, what they're after today, and what they remember of the player.
    let cast: Vec<String> = place
        .cast
        .iter()
        .filter(|c| state.patience.get(*c).is_none_or(|left| *left > 0))
        .map(|c| {
            let member = story.cast_member(c);
            let wants = member.map(|m| m.motive.trim()).filter(|m| !m.is_empty()).unwrap_or("their own business");
            let tongue = match member {
                Some(m) if m.speaks_player_language => {
                    if state.in_own_language(story, c) {
                        format!(" — speaks {} with the player right now", story.course.learner_name)
                    } else {
                        format!(" — {} only right now (house rule, the owner is here), with whispered {} hints", story.course.target_name, story.course.learner_name)
                    }
                }
                _ => String::new(),
            };
            let memories = match state.memories.get(c) {
                Some(list) if !list.is_empty() => format!("remembers the player: {}", list.join(" ")),
                _ => "has never met the player".to_string(),
            };
            format!("\n  - `{c}` ({}) — wants today: {wants}{tongue} — {memories}", name(c))
        })
        .collect();
    let next_open_exit = place
        .exits
        .iter()
        .find(|e| state.world_locked_reason(story, e).is_none())
        .and_then(|e| story.place(&e.to))
        .map(|p| format!("`{}` ({} / {})", p.id, p.name_jp, p.name));
    let goal_state = if state.goals_done.contains(&place.id) {
        format!(
            "ALREADY ACHIEVED — this is free conversation now; keep objective_complete false. Keep talking about whatever the player is talking about. Only when the conversation winds down naturally might someone mention {}; Choice #3 is a departure phrase heading there.",
            next_open_exit.unwrap_or_else(|| "an open exit".into())
        )
    } else {
        format!(
            "NOT YET — what would count: {} This is the player's own aim, not the characters': they don't know it. Let it come up from the conversation in its own time; don't steer every line toward it. (Once met, set objective_complete: true and make Choice #3 a departure phrase toward {}.)",
            place.success.trim(),
            next_open_exit.unwrap_or_else(|| "an open exit".into())
        )
    };
    // Everything that can change the world here, and whether it can now.
    let cur = &story.course.currency;
    let events: Vec<String> = place
        .events
        .iter()
        .filter(|e| e.repeatable || !state.flags.contains(&e.flag))
        .map(|e| {
            let mut fx = Vec::new();
            if e.cost > 0 {
                fx.push(format!("player pays {cur}{}", e.cost));
            }
            if e.tops_up_to > 0 {
                fx.push(format!("player receives the difference up to {cur}{} (at most {cur}{})", e.tops_up_to, e.gives_yen));
            } else if e.gives_yen > 0 {
                fx.push(format!("player receives {cur}{}", e.gives_yen));
            }
            let items: Vec<&str> = e.gives_items.iter().filter_map(|i| story.items.iter().find(|x| &x.id == i)).map(|x| x.name.as_str()).collect();
            if !items.is_empty() {
                fx.push(format!("gives {}", items.join(", ")));
            }
            let fx = if fx.is_empty() { String::new() } else { format!(" → {}", fx.join("; ")) };
            let convey = if !e.says.is_empty() {
                format!(" — IF IT HAPPENS, the game itself then has {} say what it means (don't explain it yourself, just lead up to it): {}", e.says[0].who, e.says.iter().map(|l| l.en.as_str()).collect::<Vec<_>>().join(" "))
            } else if e.must_convey.is_empty() {
                String::new()
            } else {
                format!(" — IF IT HAPPENS, that same reply MUST make clear (through words, gestures, drawings): {}", e.must_convey.join("; "))
            };
            match state.event_blocked(story, e) {
                None => format!("- `{}` [POSSIBLE] when {}{fx}{convey}", e.flag, e.when),
                Some(why) => format!("- `{}` [NOT POSSIBLE NOW: {why}] {}", e.flag, e.when),
            }
        })
        .collect();
    let story_so_far = state.story_so_far(story);
    let facts = state.facts(story);
    let objective = state.objective_now(story);
    // The director sees the world's own locks; a story scene only holds back
    // the buttons, never a player who says where they're going.
    let exits: Vec<String> = place
        .exits
        .iter()
        .filter(|e| story.place(&e.to).is_some())
        .map(|e| match state.world_locked_reason(story, e) {
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
         When the conversation gives an opening, let a moment arise where the player needs one of the open goals — never at the cost of answering what was actually said, and never by telling them to say it.\n\
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
         talking with: {talking}\n\
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
        talking = if state.talking_to.is_empty() { "nobody yet — the player hasn't approached anyone".to_string() } else { name(&state.talking_to) },
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
    let memory_block = format!(
        "<story_so_far>\n{story_so_far}\n</story_so_far>\n\n<facts_now>\n{facts}\n</facts_now>\n\n<objective>\n{objective}\n</objective>"
    );
    let place_block = format!(
        "<place>\n\
         {name} ({name_jp}) — scene `{scene}`\n\
         Situation: {situation}\n\
         People here: {cast}\n\
         Visit: {visit}{versions}\n\
         The player's goal here (their own thought): {goal}\n\
         Goal status: {goal_state}\n\
         Story events here — the ONLY way money, items and story facts change. Put an event's flag in flags_set in the reply where it happens on screen, and only if it's POSSIBLE; the game applies its effects (you never change money or items yourself). Never act out a NOT POSSIBLE one: the people here can't do it right now, so they react to why.\n{events}\n\
         Exits (set go_to only to an OPEN one):\n{exits}\n\
         </place>",
        name = place.name,
        name_jp = place.name_jp,
        scene = place.scene,
        situation = place.situation.trim(),
        cast = if cast.is_empty() { "only passers-by (use speaker \"extra\" with a speaker_name)".into() } else { cast.concat() },
        goal = place.goal,
        versions = {
            let v = story.scene_versions(&place.scene);
            if v.is_empty() {
                String::new()
            } else {
                let list: Vec<String> = std::iter::once(format!("`{}` ({})", place.scene, place.clock))
                    .chain(v.iter().map(|s| format!("`{}` ({}{})", s.id, s.name, if s.clock.is_empty() { String::new() } else { format!(", {}", s.clock) })))
                    .collect();
                format!(
                    "\nTimes of day here: {}. On screen now: `{}`. When the time of day changes (the player wakes at dawn, or arrives in the daytime), set `scene` on that beat to the matching one, with transition \"wake\" or \"fade\".",
                    list.join(", "),
                    state.scene
                )
            }
        },
        visit = if state.revisit {
            let done: Vec<&str> = place
                .goal_flags
                .iter()
                .chain(place.events.iter().map(|e| &e.flag))
                .filter(|f| state.flags.contains(*f))
                .map(String::as_str)
                .collect();
            format!(
                "RETURN VISIT — the player has been here before. Everything that already happened here stays done{}{}: \
                 the people here remember it, and never redo it — no filling the same form again, no re-asking questions already answered, \
                 no handing over again what they already gave. Any FIRST VISIT parts of the situation are over; follow its RETURN VISIT parts. \
                 Greet the player as someone they've met and ask what brings them back.",
                if state.goals_done.contains(&place.id) { " (the player's goal here was achieved)" } else { "" },
                if done.is_empty() { String::new() } else { format!("; story events already done: {}", done.join(", ")) },
            )
        } else {
            "first visit — the player has never been here".to_string()
        },
        events = if events.is_empty() { "none".into() } else { events.join("\n") },
        exits = if exits.is_empty() { "none — this is the end of the line".into() } else { exits.join("\n") },
    );
    let ask = match prompt {
        Prompt::Turn { input, via } => format!(
            "<player_said via=\"{via}\">{input}</player_said>\n\
             Reply to this line first, as the next moment of the conversation in the transcript: pick up what was just said and anything left hanging earlier.",
            via = match via {
                InputVia::Voice => "voice",
                InputVia::Text => "text",
                InputVia::Choice => "suggested_reply",
            }
        ),
        Prompt::Arrival { from } => format!(
            "<arrival from=\"{from}\"/>\n\
             The player has just arrived here. Write 2–4 beats: what they see (narration) and their own inner monologue (\"{THOUGHT}\") — what this place is, what they need here and who might help. \
             Bring everyone who is here into view with `enter` on a narration beat, busy with their own lives. Nobody walks up to the player or starts talking to them UNLESS this place's situation says they come to the player; otherwise the player decides whom to approach. \
             There is no player line to judge: coach.verdict \"none\", grammar_used [], objective_complete false, go_to \"stay\", flags_set []. \
             Choices: 3 openers the player could say to someone here (\"excuse me…\", a question about what they need).",
            from = from.and_then(|f| story.place(f)).map(|p| p.name.as_str()).unwrap_or("nowhere — the story begins"),
        ),
        Prompt::Approach { who } => format!(
            "<approach who=\"{who}\"/>\n\
             The player walks up to {name} to talk. Write 2–4 beats: a short narration of them approaching, then {name} reacting in character — what they are in the middle of, their mood, what they want today — and speaking first, the way someone would to a stranger who comes up to them. \
             There is no player line to judge: coach.verdict \"none\", grammar_used [], objective_complete false, go_to \"stay\", flags_set []. Choices: 3 things the player could say to {name} now.",
            name = name(who),
        ),
        Prompt::Look => "<look_around/>\n\
             The player stops to look around and think. Write 2–4 beats, mostly their inner monologue (\"thought\") with a little narration: what they notice here, \
             what they understand of what has happened so far, what they still need and which person or exit could help. Nobody new talks to them. \
             There is no player line to judge: coach.verdict \"none\", grammar_used [], objective_complete false, go_to \"stay\", flags_set []. Choices: 3 things they could say next to someone here."
            .to_string(),
    };

    let pressure_block = pressure_message(story, state, place);
    format!("{state_block}\n\n{memory_block}\n\n{place_block}\n\n{teaching_block}\n\n{pressure_block}\n\n<transcript>\n{lines}</transcript>\n\n{ask}")
}

/// How much time the people here have left, so the director can let it show.
fn pressure_message(story: &Story, state: &RunState, place: &Place) -> String {
    let people: Vec<String> = state
        .patience
        .iter()
        .filter_map(|(id, left)| {
            let c = story.cast_member(id)?;
            if !state.engaged.contains(id) {
                return Some(format!("{} — hasn't talked with the player yet; going about their own business", c.name));
            }
            let mood = match *left {
                l if l <= 0 => "has left",
                1 => "MUST make clear this turn that they're about to leave (\"I have to go soon…\", picking up their bag)",
                2..=3 => "impatient — show it in this turn's beats: a glance at a watch or the clock, a shorter answer, a sigh",
                _ => "has time",
            };
            Some(format!("{} — {left}/{} turns: {mood}", c.name, c.patience))
        })
        .collect();
    let timer = match (state.timer_left, &place.timer) {
        (Some(left), Some(t)) if left > 0 => format!("\nClock: \"{}\" in {left} turn(s). Let the world remind the player as it gets close (announcements, a glance at the board).", t.label),
        _ => String::new(),
    };
    format!(
        "<pressure>\n\
         Patience: {people}{timer}\n\
         Show impatience in character, never as a number. Don't end the conversation or walk anyone off yourself — the game does that when time runs out.\n\
         </pressure>",
        people = if people.is_empty() { "nobody here is waiting on the player".to_string() } else { people.join("; ") },
    )
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
    let (l, s): (Vec<char>, Vec<char>) = (squash(line).chars().collect(), squash(said).chars().collect());
    if l.is_empty() || s.is_empty() {
        return false;
    }
    let (short, long) = if l.len() <= s.len() { (&l, &s) } else { (&s, &l) };
    // Too different in length to be the same sentence (e.g. one word echoed back).
    if short.len() * 5 < long.len() * 4 {
        return false;
    }
    // A cut-off copy of the player's sentence.
    let (short_s, long_s): (String, String) = (short.iter().collect(), long.iter().collect());
    if long_s.contains(&short_s) {
        return true;
    }
    // Longest common subsequence: tolerates a dropped particle or "o"/"wo".
    let mut row = vec![0usize; short.len() + 1];
    for &c in long.iter() {
        let mut prev = 0;
        for j in 1..=short.len() {
            let keep = row[j];
            row[j] = if short[j - 1] == c { prev + 1 } else { row[j].max(row[j - 1]) };
            prev = keep;
        }
    }
    row[short.len()] * 10 >= long.len() * 9
}

fn accept_beats(story: &Story, state: &mut RunState, raw: Vec<Beat>, said: &str) -> Vec<Beat> {
    let place = state.place(story).clone();
    let mut beats = Vec::new();
    // Entrances from beats that turn out empty ride on the next one.
    let mut entering: Vec<String> = Vec::new();
    for mut b in raw.into_iter().take(MAX_BEATS_PER_TURN) {
        b.enter.retain(|c| place.cast.contains(c) && state.patience.get(c).is_none_or(|left| *left > 0));
        entering.append(&mut b.enter);
        if !said.is_empty() && !is_inner(&b.speaker) && (echoes(&b.jp, said) || echoes(&b.romaji, said)) {
            continue;
        }
        // A character line with no words is really a stage direction (or the
        // player's own line handed back): narrate it, or drop the echo.
        if !is_inner(&b.speaker) && b.jp.trim().is_empty() {
            if !said.is_empty() && echoes(&b.en, said) {
                continue;
            }
            b.speaker = NARRATOR.into();
            b.speaker_name.clear();
        }
        // Scene changes happen by moving between places, not mid-scene —
        // except to another time of day of this place (the dorm at dawn).
        let version = b.scene == place.scene || story.scene_versions(&place.scene).iter().any(|v| v.id == b.scene);
        if !version {
            b.scene.clear();
        }
        // A named side character spoken as an "extra" is that character.
        if b.speaker == EXTRA
            && let Some(m) = story.minor_by_name(&b.speaker_name)
        {
            b.speaker = m.id.clone();
            b.speaker_name.clear();
        }
        // Any other stranger gets a passer-by's face and voice — by their
        // name or role, or, if the director gave none, any passer-by.
        if b.speaker == EXTRA && !place.unseen_extras {
            let face = if b.speaker_name.trim().is_empty() { story.any_townsfolk(&b.jp) } else { story.townsfolk_for(&b.speaker_name) };
            if let Some(id) = face {
                b.speaker = id;
            }
        }
        let minor = story.cast_member(&b.speaker).is_some_and(|c| c.minor || c.townsfolk);
        let speaker_ok = is_inner(&b.speaker) || b.speaker == EXTRA || minor || place.cast.contains(&b.speaker);
        if !speaker_ok {
            // Keep the line but voice it as a named extra.
            b.speaker_name = story.cast_member(&b.speaker).map(|c| c.name.clone()).unwrap_or_default();
            b.speaker = EXTRA.into();
        }
        if b.speaker == EXTRA && b.speaker_name.is_empty() {
            b.speaker_name = "???".into();
        }
        if is_inner(&b.speaker) {
            b.jp.clear();
            b.romaji.clear();
        }
        // A fellow foreigner talks with the player in their own language:
        // what they say is the sentence the director wrote as its meaning.
        if state.in_own_language(story, &b.speaker) && !b.en.trim().is_empty() {
            b.jp = b.en.clone();
            b.romaji.clear();
        }
        if b.jp.is_empty() && b.en.is_empty() {
            continue;
        }
        // Nobody says the same thing twice in a scene.
        if state.repeats(&b) {
            continue;
        }
        entering.retain(|c| !state.on_stage.contains(c) && c != &b.speaker);
        b.enter = std::mem::take(&mut entering);
        state.note_said(&b);
        state.track_stage(&b);
        beats.push(b);
    }
    beats
}

/// Memories kept per person: enough for a life, small enough for the prompt.
const MEMORIES_PER_PERSON: usize = 10;

/// Records what people will remember about the player. Anyone who just
/// talked with the player for the first time remembers where they met.
fn remember(story: &Story, state: &mut RunState, notes: &[crate::director::Memory]) {
    let place = state.place(story).name.clone();
    for id in state.engaged.clone() {
        if story.cast_member(&id).is_some_and(|c| !c.townsfolk) && !state.memories.contains_key(&id) {
            state.memories.entry(id).or_default().push(format!("First met the player at {place}."));
        }
    }
    for m in notes.iter().take(2) {
        let known = story.cast_member(&m.character).is_some_and(|c| !c.townsfolk);
        let note: String = m.note.trim().chars().take(160).collect();
        if !known || note.is_empty() {
            continue;
        }
        let list = state.memories.entry(m.character.clone()).or_default();
        if !list.contains(&note) {
            list.push(note);
        }
        // Keep the first meeting; let the oldest of the rest fade.
        while list.len() > MEMORIES_PER_PERSON {
            list.remove(1);
        }
    }
}

fn take_lead(state: &mut RunState, lead: &str) {
    let lead: String = lead.trim().chars().take(140).collect();
    if !lead.is_empty() {
        state.lead = lead;
    }
}

fn take_choices(story: &Story, state: &mut RunState, choices: Vec<Phrase>) {
    // Three different moves the player could make from here. Dropped: copies
    // of one another, a second "I'm going…", and "I'm going to X" where X
    // isn't somewhere they can walk to from this place.
    let mut kept: Vec<Phrase> = Vec::new();
    let mut departing = false;
    for c in choices.into_iter().filter(|c| !c.jp.trim().is_empty()) {
        let both = format!("{} {}", c.jp, c.en);
        let to = intended_exit(story, state, &both);
        if to.is_none() && is_going(&both) && names_a_place(story, &both) {
            continue;
        }
        if to.is_some() && std::mem::replace(&mut departing, true) {
            continue;
        }
        if kept.iter().any(|k| echoes(&k.jp, &c.jp) || echoes(&k.en, &c.en)) {
            continue;
        }
        if claims_wrong_money(&c.en, state.yen) || claims_wrong_money(&c.jp, state.yen) {
            continue;
        }
        // A suggested "I'm going to …" means the conversation has sent them there.
        if let Some(to) = to {
            state.pointed.insert(to);
        }
        kept.push(c);
        if kept.len() == 3 {
            break;
        }
    }
    // Whatever can actually be done here now (buy the ticket you can afford)
    // is always the first option, in the game's own words.
    if let Some(place) = story.place(&state.place) {
        for e in place.events.iter().rev() {
            let Some(ask) = &e.ask else { continue };
            let known = e.price_known_by.is_empty() || state.flags.contains(&e.price_known_by);
            if known && state.event_blocked(story, e).is_none() && !kept.iter().any(|k| echoes(&k.jp, &ask.jp)) {
                kept.insert(0, ask.clone());
                kept.truncate(3);
            }
        }
    }
    if !kept.is_empty() {
        state.choices = kept;
    }
    state.choices_unlocked = false;
}

/// A line saying the player hasn't got enough money ("I'm ¥270 short").
fn claims_short(en: &str) -> bool {
    let low = en.to_lowercase();
    ["short", "still need", "not enough", "don't have enough", "need the last", "need another"].iter().any(|w| low.contains(w))
        && (low.chars().any(|c| c.is_ascii_digit()) || low.contains("enough") || low.contains("money"))
}

/// "I have 1,000 yen" when the player has ¥1,500: a reply written from an
/// out-of-date idea of their money.
fn claims_wrong_money(en: &str, yen: i64) -> bool {
    let low = en.to_lowercase();
    if !(low.contains("i have") || low.contains("i've got") || low.contains("i only have")) {
        return false;
    }
    let mut amounts = Vec::new();
    let mut digits = String::new();
    for ch in low.chars().chain(std::iter::once(' ')) {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else if ch != ',' || digits.is_empty() {
            if let Ok(n) = digits.parse::<i64>() {
                amounts.push(n);
            }
            digits.clear();
        }
    }
    !amounts.is_empty() && !amounts.contains(&yen)
}

/// Exits this turn talked about — in the player's thought, the narration or
/// what someone said — open their "Go →" even mid-scene: if the game tells
/// the player the police box is upstairs, they can go up. And when someone
/// here names a place whose way is only waiting on a story flag this scene
/// can give ("someone tells the player where the guesthouse is"), being told
/// is enough: the flag is set.
fn note_pointed(story: &Story, state: &mut RunState, beats: &[Beat], lead: &str, said: &str) {
    let squashed = |texts: Vec<String>| to_hiragana(&texts.join(" ").to_lowercase());
    let all = squashed(beats.iter().map(|b| format!("{} {}", b.jp, b.en)).chain(std::iter::once(lead.to_string())).collect());
    // Told by someone here — or the player says they're heading there, so
    // they clearly know the way (someone told them somewhere else).
    let told = squashed(
        beats
            .iter()
            .filter(|b| !is_inner(&b.speaker) && b.speaker != PLAYER)
            .map(|b| format!("{} {}", b.jp, b.en))
            .chain(is_going(said).then(|| said.to_string()))
            .collect(),
    );
    for p in &story.places {
        if place_names(p).iter().any(|n| told.contains(n.as_str())) {
            state.heard_of.insert(p.id.clone());
        }
    }
    let place = state.place(story).clone();
    for e in &place.exits {
        if story.place(&e.to).is_some_and(|to| place_names(to).iter().any(|n| all.contains(n.as_str()))) {
            state.pointed.insert(e.to.clone());
        }
    }
    state.open_heard_ways(story);
}

/// Every name a place goes by, in the form `squash`-free matching uses.
fn place_names(p: &Place) -> Vec<String> {
    std::iter::once(p.name.to_lowercase())
        .chain(std::iter::once(p.name_jp.clone()))
        .chain(p.aliases.iter().map(|a| to_hiragana(&a.to_lowercase())))
        .filter(|n| n.chars().count() >= 2)
        .collect()
}

/// Learns which places characters have told the player about from earlier
/// lines (for saves from before `heard_of` was kept), then opens those ways.
pub fn hear_from(story: &Story, state: &mut RunState, lines: &[Beat]) {
    let told = to_hiragana(
        &lines
            .iter()
            .filter(|b| !is_inner(&b.speaker) && b.speaker != PLAYER)
            .map(|b| format!("{} {}", b.jp, b.en))
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase(),
    );
    for p in &story.places {
        if place_names(p).iter().any(|n| told.contains(n.as_str())) {
            state.heard_of.insert(p.id.clone());
        }
    }
    state.open_heard_ways(story);
}

fn is_going(text: &str) -> bool {
    let said = to_hiragana(&text.to_lowercase());
    GOING.iter().any(|g| said.contains(g)) || ["行きます", "行く", "向かいます", "帰ります", "戻ります"].iter().any(|g| text.contains(g))
}

/// Does this mention any place in the story by name?
fn names_a_place(story: &Story, text: &str) -> bool {
    let said = to_hiragana(&text.to_lowercase());
    story.places.iter().any(|p| {
        std::iter::once(p.name.to_lowercase())
            .chain(std::iter::once(p.name_jp.clone()))
            .chain(p.aliases.iter().map(|a| to_hiragana(&a.to_lowercase())))
            .any(|n| n.chars().count() >= 2 && said.contains(n.as_str()))
    })
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
        .place(story)
        .exits
        .iter()
        .filter(|e| state.can_walk(story, &e.to))
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
#[cfg(test)]
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
    let steps_before = state.steps_done.clone();
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

    // The world changes only through this place's declared events, each
    // allowed (or not) by the rules and applied by the game.
    // Knowledge that comes from hearing it ("¥1,270") happens when someone
    // actually says it, whether or not the director remembered the event.
    let mut happened = turn.flags_set.clone();
    for e in place.events.iter().filter(|e| !e.heard.is_empty()) {
        let said = beats
            .iter()
            .filter(|b| !is_inner(&b.speaker) && b.speaker != PLAYER)
            .any(|b| e.heard.iter().any(|h| b.jp.replace(',', "").contains(&h.replace(',', "")) || b.en.replace(',', "").contains(&h.replace(',', ""))));
        if said && !happened.contains(&e.flag) {
            happened.push(e.flag.clone());
        }
    }
    let short = state.run_events(story, &place, &happened, &mut beats);
    if short {
        beats.push(Beat::narration(&story.course.short_of_money));
    }
    for t in turn.state.trust {
        if place.cast.contains(&t.character) || state.on_stage.contains(&t.character) {
            let v = state.trust.entry(t.character).or_default();
            *v = (*v + t.delta.clamp(-TRUST_STEP, TRUST_STEP)).clamp(-TRUST_RANGE, TRUST_RANGE);
        }
    }
    let goal_flags_set = !place.goal_flags.is_empty() && place.goal_flags.iter().all(|gf| state.flags.contains(gf));

    take_choices(story, state, turn.choices);
    note_pointed(story, state, &beats, &turn.lead, input);
    take_lead(state, &turn.lead);
    remember(story, state, &turn.remember);
    let new_phrases: Vec<Phrase> = turn.new_phrases.into_iter().filter(|p| !p.jp.trim().is_empty()).take(2).collect();

    // The place's goal: once, after the player has actually engaged. Where
    // the goal is made of facts, the game decides; only goals described in
    // words alone are the director's call.
    let mut goal_complete = None;
    let met = if place.goal_flags.is_empty() { turn.objective_complete } else { goal_flags_set };
    if met && state.place_turns >= 1 && !state.goals_done.contains(&place.id) {
        goal_complete = Some(finish_goal(story, state, &place, &turn.journal, &turn.next_steps, &mut beats));
    }

    // Once the current place's goal is achieved, ensure at least one suggested choice
    // lets the player depart to the primary open exit so they never get stuck in a loop.
    if state.goals_done.contains(&place.id) && turn.go_to == "stay" && !state.choices.is_empty() {
        let has_exit_choice = state
            .choices
            .iter()
            .any(|c| intended_exit(story, state, &c.jp).is_some() || intended_exit(story, state, &c.en).is_some());
        if !has_exit_choice
            && let Some(next_place) = {
                // Somewhere new before somewhere already seen.
                let open: Vec<ExitView> = state.exits(story).into_iter().filter(|e| e.open).collect();
                open.iter().find(|e| !e.visited).or(open.first()).and_then(|e| story.place(&e.to))
            }
        {
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

    let mut go_to = (turn.go_to != "stay" && turn.go_to != place.id && state.can_walk(story, &turn.go_to)).then_some(turn.go_to);

    if go_to.is_none() {
        state.think(story, &mut beats, &turn.lead);
    }

    // Pressure: people's patience and the scene's clock.
    let (departed, scene_over, forced) = apply_pressure(story, state, &place, turn.coach.verdict, &mut beats);
    if go_to.is_none() {
        go_to = forced;
    }

    let steps_done = story
        .quests
        .iter()
        .flat_map(|q| q.steps.iter().filter(|st| {
            let key = RunState::step_key(q, st);
            state.steps_done.contains(&key) && !steps_before.contains(&key)
        }).map(|st| st.title.clone()))
        .collect();
    TurnOutcome {
        steps_done,
        departed,
        scene_over,
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

/// Patience drains a turn at a time, faster when the player isn't understood
/// and slower when it goes well; trust buys a little grace. A character who
/// runs out leaves; a scene whose people have all left, or whose timer fires,
/// has run its course. Returns (departed, scene_over, forced move).
fn apply_pressure(
    story: &Story,
    state: &mut RunState,
    place: &Place,
    verdict: crate::story::Verdict,
    beats: &mut Vec<Beat>,
) -> (Vec<String>, Option<String>, Option<String>) {
    use crate::story::Verdict;
    if state.scene_over.is_some() {
        return (Vec::new(), None, None);
    }
    // Beginners get twice the time: a good line costs nothing, a miss costs one.
    let cost = match (verdict, state.difficulty) {
        (Verdict::Great, _) => 0,
        (Verdict::Good, Difficulty::Beginner) => 0,
        (Verdict::NotUnderstood | Verdict::English, Difficulty::Beginner) => 1,
        (Verdict::Good | Verdict::Understood | Verdict::none, _) => 1,
        (Verdict::NotUnderstood | Verdict::English, _) => 2,
    };
    let mut departed = Vec::new();
    for (id, left) in state.patience.iter_mut() {
        if *left <= 0 || !state.engaged.contains(id) {
            continue;
        }
        // Someone who trusts you lets every third slip go.
        let grace = state.trust.get(id).copied().unwrap_or(0) >= 3 && state.place_turns.is_multiple_of(3);
        *left -= if grace { 0 } else { cost };
        if *left <= 0 {
            departed.push(id.clone());
        }
    }
    for id in &departed {
        state.on_stage.retain(|c| c != id);
        if &state.talking_to == id {
            state.talking_to.clear();
        }
        if let Some(c) = story.cast_member(id) {
            let line = if c.leaves.is_empty() { story.course.leaves.replace("{name}", &c.name) } else { c.leaves.clone() };
            beats.push(Beat::narration(&line));
        }
    }

    let mut scene_over = None;
    let mut forced = None;
    if let (Some(left), Some(timer)) = (state.timer_left.as_mut(), place.timer.as_ref()) {
        *left = left.saturating_sub(1);
        if *left == 0 {
            beats.push(Beat::narration(&timer.expires));
            state.flags.extend(timer.flags.iter().cloned());
            if !timer.go_to.is_empty() {
                forced = Some(timer.go_to.clone());
            }
            scene_over = Some("timer".to_string());
        }
    }
    if scene_over.is_none() && !state.patience.is_empty() && state.patience.values().all(|v| *v <= 0) {
        scene_over = Some("patience".to_string());
    }
    state.scene_over = scene_over.clone();
    (departed, scene_over, forced)
}

/// Applies an improvised arrival: only beats and choices count.
pub fn apply_arrival(story: &Story, state: &mut RunState, turn: DirectorTurn) -> Vec<Beat> {
    let mut beats = accept_beats(story, state, turn.beats, "");
    take_lead(state, &turn.lead);
    remember(story, state, &turn.remember);
    take_choices(story, state, turn.choices);
    note_pointed(story, state, &beats, &turn.lead, "");
    state.stage_everyone(story, &mut beats);
    state.think(story, &mut beats, &turn.lead);
    beats
}

/// What happens when the player approaches someone or looks around: no line
/// to judge and no patience spent, but the scene's clock still runs.
pub struct ActOutcome {
    pub beats: Vec<Beat>,
    pub departed: Vec<String>,
    pub scene_over: Option<String>,
    pub go_to: Option<String>,
}

pub fn apply_act(story: &Story, state: &mut RunState, turn: DirectorTurn, approached: Option<&str>) -> ActOutcome {
    let place = state.place(story).clone();
    if let Some(who) = approached {
        state.engaged.insert(who.to_string());
        state.talking_to = who.to_string();
    }
    let mut beats = accept_beats(story, state, turn.beats, "");
    take_lead(state, &turn.lead);
    remember(story, state, &turn.remember);
    take_choices(story, state, turn.choices);
    note_pointed(story, state, &beats, &turn.lead, "");
    state.think(story, &mut beats, &turn.lead);
    // Whoever you walked up to is on stage, whether or not the director said so.
    if let Some(who) = approached
        && !state.on_stage.iter().any(|c| c == who)
    {
        match beats.first_mut() {
            Some(first) => first.enter.push(who.to_string()),
            None => beats.push(Beat { enter: vec![who.to_string()], ..Beat::narration(&story.course.nod) }),
        }
        state.on_stage.push(who.to_string());
    }
    let (departed, scene_over, go_to) = apply_pressure(story, state, &place, crate::story::Verdict::Great, &mut beats);
    ActOutcome { beats, departed, scene_over, go_to }
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
            let place = state.place(story).name.clone();
            state.log(&place, t.narration.clone());
            out.push(Beat::narration(&t.narration));
        }
    }
    state.update_steps(story);
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

/// The skill-tree node for a lesson. Each lesson of the course is a node, so
/// the tree follows whichever curriculum the course teaches.
pub fn lesson_node_id(index: usize) -> String {
    format!("lesson_{index}")
}

/// Passively checks the player's spoken line against every lesson's grammar
/// and can-dos, awakening or levelling up that lesson's node on the skill
/// tree regardless of the current lesson.
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

    for lesson in &story.lessons {
        let hit_grammar = grammar_used.iter().any(|g| lesson.grammar.iter().any(|lg| &lg.id == g));
        let hit_cando = matched_candos.iter().any(|c| lesson.candos.iter().any(|lc| &lc.id == c));
        if !hit_grammar && !hit_cando {
            continue;
        }
        let node_id = lesson_node_id(lesson.index);

        if let Some(existing) = state.unlocked_skills.get_mut(&node_id) {
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
                node_id: node_id.clone(),
                branch: "lesson".into(),
                title: lesson.title.clone(),
                title_jp: lesson.title_jp.clone(),
                icon: String::new(),
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
            state.unlocked_skills.insert(node_id, skill.clone());
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

    /// Enters a place with its goal already done, for tests about where the
    /// player can go rather than about finishing the scene.
    fn roam(story: &Story, s: &mut RunState, id: &str) {
        s.enter_place(story, id);
        s.goals_done.insert(id.into());
    }

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
            state: StateChange { trust: vec![] },
            new_phrases: vec![],
            objective_complete: complete,
            go_to: go_to.into(),
            flags_set: vec![],
            journal: String::new(),
            lead: String::new(),
            remember: vec![],
            next_steps: vec![],
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
        roam(&story, &mut s, "asakusa_street");
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
        roam(&story, &mut s, "koban");
        assert!(s.can_go(&story, "airport_station"), "Officer Sato points to the station");
        let out = apply_turn(&story, &mut s, turn(false, &[], "airport_station"), InputVia::Voice, "");
        assert_eq!(out.go_to.as_deref(), Some("airport_station"));
        // Tickets are sold at the window, and only for the full fare.
        roam(&story, &mut s, "ticket_window");
        let buy = || {
            let mut t = turn(false, &[], "stay");
            t.flags_set = vec!["has_ticket".into()];
            t
        };
        s.yen = 1000;
        let short = apply_turn(&story, &mut s, buy(), InputVia::Voice, "");
        assert!(!s.can_go(&story, "train_to_ueno"), "¥1,000 doesn't buy a ¥1,270 ticket");
        assert_eq!(s.yen, 1000);
        assert!(short.beats.iter().any(|b| b.en == story.course.short_of_money));
        s.yen = 1300;
        apply_turn(&story, &mut s, buy(), InputVia::Voice, "");
        assert!(s.can_go(&story, "train_to_ueno"));
        assert_eq!(s.yen, 30);
    }

    #[test]
    fn characters_never_parrot_the_player() {
        assert!(echoes("Thank you! I think this donut is better than the sausage. Please don't", "Thank you! I think this donut is better than the sausage. Please dont laugh, I am messy!"));
        assert!(echoes("すみません、かばんがありません！", "すみません かばんが ありません"));
        // Repeating one word back to check it is natural.
        assert!(!echoes("Bag?", "My bag is gone"));
        assert!(!echoes("かばん？", "かばんがありません"));
        // Romaji typed, kana handed back with a particle added.
        assert!(echoes("Hai! Osara o araimasu. Ganbarimasu.", "hai! sara o araimasu. ganbarimasu"));
        assert!(!echoes("Hai, osara o aratte kudasai.", "hai! sara o araimasu. ganbarimasu"));
    }

    #[test]
    fn wordless_character_lines_become_narration() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        let said = "I'm okay, my bag isn't here";
        let beats = vec![
            Beat { en: "I'm okay... my bag isn't here.".into(), ..Beat::player("") }.with_speaker("kenji"),
            Beat { en: "Kenji points toward the police box.".into(), ..Beat::player("") }.with_speaker("kenji"),
        ];
        let out = accept_beats(&story, &mut s, beats, said);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].speaker, NARRATOR);
    }

    #[test]
    fn the_skill_tree_follows_each_courses_lessons() {
        for (course, said, lesson) in [("ja", "かえりたいです", 11), ("en", "I want to go home", 11)] {
            let story = Story::load(std::path::Path::new(&format!("content/courses/{course}/story.toml"))).unwrap();
            let (mut s, _) = RunState::new(&story, "Ren".into());
            s.goals_done.insert(s.place.clone());
            assert!(update_skill_tree(&story, &mut s, said, &[], &[], true, "good", None).is_some(), "{course}");
            assert!(s.unlocked_skills.contains_key(&lesson_node_id(lesson)), "{course}");
            // Speaking a later lesson's grammar opens exits locked behind that lesson.
            let locked = Exit { to: "x".into(), label: String::new(), requires_flags: vec![], min_lesson: lesson, open_in_scene: false };
            assert!(s.exit_locked_reason(&story, &locked).is_none(), "{course}");
            let other = Exit { min_lesson: lesson - 1, ..locked };
            assert!(s.exit_locked_reason(&story, &other).is_some(), "{course}");
        }
    }

    #[test]
    fn patience_runs_out_and_people_leave() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "airport_station");
        s.engaged.insert("hiroshi".into()); // the player walked up to him
        s.difficulty = Difficulty::Intermediate;
        let start = s.patience["hiroshi"];
        // Not being understood costs double.
        let mut t = turn(false, &[], "stay");
        t.coach.verdict = Verdict::NotUnderstood;
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(s.patience["hiroshi"], start - 2);
        let mut out = None;
        for _ in 0..start {
            let o = apply_turn(&story, &mut s, turn(false, &[], "stay"), InputVia::Voice, "");
            if !o.departed.is_empty() {
                out = Some(o);
                break;
            }
        }
        let out = out.expect("hiroshi runs out of patience");
        assert_eq!(out.departed, vec!["hiroshi".to_string()]);
        assert_eq!(out.scene_over.as_deref(), Some("patience"));
        assert!(!s.on_stage.contains(&"hiroshi".to_string()));
        // Once over, nothing more drains or ends.
        let again = apply_turn(&story, &mut s, turn(false, &[], "stay"), InputVia::Voice, "");
        assert!(again.departed.is_empty() && again.scene_over.is_none());
    }

    #[test]
    fn only_people_you_talk_to_lose_patience() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        // A return visit: no scripted intro where Gen-san speaks first.
        s.enter_place(&story, "ueno_park");
        s.enter_place(&story, "ueno_park");
        s.difficulty = Difficulty::Intermediate;
        // Gen-san lives here: he's in view, but not waiting on the player.
        assert_eq!(s.present(&story), vec!["gensan".to_string()]);
        s.on_stage.clear();
        let mut arrival = turn(false, &[], "stay");
        arrival.beats = vec![Beat { speaker: THOUGHT.into(), jp: "え".into(), ..Beat::narration("A park. Someone is packing up a guitar.") }];
        let beats = apply_arrival(&story, &mut s, arrival);
        assert!(beats[0].jp.is_empty(), "thoughts carry no target-language text");
        assert_eq!(beats[0].enter, vec!["gensan".to_string()]);
        assert!(s.on_stage.contains(&"gensan".to_string()));
        let start = s.patience["gensan"];
        let mut t = turn(false, &[], "stay");
        t.beats = vec![Beat::narration("You watch the pond.")];
        t.coach.verdict = Verdict::NotUnderstood;
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(s.patience["gensan"], start, "not approached, not waiting");

        // Walking up to him starts the conversation, and only talking costs time.
        let mut hello = turn(false, &[], "stay");
        hello.beats = vec![Beat { jp: "おや".into(), ..Beat::player("") }.with_speaker("gensan")];
        let out = apply_act(&story, &mut s, hello, Some("gensan"));
        assert_eq!(s.talking_to, "gensan");
        assert!(out.departed.is_empty());
        assert_eq!(s.patience["gensan"], start, "approaching is free");
        let mut t = turn(false, &[], "stay");
        t.coach.verdict = Verdict::NotUnderstood;
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(s.patience["gensan"], start - 2);
    }

    #[test]
    fn people_remember_the_player_across_places() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "airport_station");
        let mut t = turn(false, &[], "stay");
        t.beats = vec![Beat { jp: "そうですか。".into(), ..Beat::player("") }.with_speaker("hiroshi")];
        t.remember = vec![
            crate::director::Memory { character: "hiroshi".into(), note: "Told me they lost their passport.".into() },
            crate::director::Memory { character: "folk_station".into(), note: "Passers-by don't keep memories.".into() },
        ];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        let hiroshi = &s.memories["hiroshi"];
        assert!(hiroshi[0].starts_with("First met the player at"));
        assert!(hiroshi.contains(&"Told me they lost their passport.".to_string()));
        assert!(!s.memories.contains_key("folk_station"));
        // Two places later, he still knows.
        s.enter_place(&story, "train_to_ueno");
        let msg = director_message(&story, &s, &[], Prompt::Look);
        assert!(msg.contains("Told me they lost their passport."));
    }

    #[test]
    fn return_visits_are_announced() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "koban");
        assert!(director_message(&story, &s, &[], Prompt::Look).contains("first visit"));
        s.flags.insert("reported_theft".into());
        s.goals_done.insert("koban".into());
        s.enter_place(&story, "airport_station");
        s.enter_place(&story, "koban");
        let msg = director_message(&story, &s, &[], Prompt::Look);
        assert!(msg.contains("RETURN VISIT") && msg.contains("reported_theft") && msg.contains("goal here was achieved"));
    }

    #[test]
    fn no_repeats_and_the_player_always_knows_what_to_do() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "koban");
        let ask = || Beat { jp: "なにを とられましたか。".into(), ..Beat::player("") }.with_speaker("yumi");
        let mut t = turn(false, &[], "stay");
        t.beats = vec![ask(), Beat::narration("She taps the passport icon on her notepad, then the wallet.")];
        t.lead = "I think she's asking what was stolen.".into();
        let out = apply_turn(&story, &mut s, t, InputVia::Voice, "");
        let last = out.beats.last().unwrap();
        assert_eq!((last.speaker.as_str(), last.en.as_str()), (THOUGHT, "I think she's asking what was stolen."));
        // The same question and the same thought again are dropped.
        let mut t = turn(false, &[], "stay");
        t.beats = vec![ask(), Beat { jp: "パスポートですね。".into(), ..Beat::player("") }.with_speaker("yumi")];
        t.lead = "I think she's asking what was stolen.".into();
        let out = apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(out.beats.iter().map(|b| b.jp.as_str()).collect::<Vec<_>>(), vec!["パスポートですね。"]);
        // Advanced players work it out themselves.
        s.difficulty = Difficulty::Advanced;
        let mut t = turn(false, &[], "stay");
        t.lead = "Something new to think about.".into();
        let out = apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert!(!out.beats.iter().any(|b| b.speaker == THOUGHT));
    }

    #[test]
    fn story_scenes_open_their_exits_once_the_goal_is_done() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "koban");
        assert!(!s.can_go(&story, "airport_station"), "a story scene holds the player");
        s.goals_done.insert("koban".into());
        assert!(s.can_go(&story, "airport_station"), "done: free to go");
        // A scene that runs its course, or a long stay, never traps anyone.
        s.enter_place(&story, "ticket_window");
        s.scene_over = Some("patience".into());
        assert!(!s.in_story_scene(&story));
        s.enter_place(&story, "soba_stand");
        s.place_turns = ROAM_AFTER;
        assert!(!s.in_story_scene(&story));
    }

    #[test]
    fn where_the_conversation_points_you_can_go() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        // Kenji points to the police box but the goal isn't marked done.
        assert!(!s.can_go(&story, "koban"));
        let mut t = turn(false, &[], "stay");
        t.choices = vec![Phrase { jp: "わかりました。こうばんに行きます。".into(), romaji: String::new(), en: "Okay. I'm going to the police box now.".into() }];
        let out = apply_turn(&story, &mut s, t, InputVia::Voice, "はい、わかりました。");
        assert!(out.go_to.is_none());
        assert!(s.can_go(&story, "koban"), "the suggested reply points there, so its button opens");
        // And saying it is always enough.
        let (mut s, _) = RunState::new(&story, "Ren".into());
        assert_eq!(intended_exit(&story, &s, "こうばんに行きます").as_deref(), Some("koban"));
        let out = apply_turn(&story, &mut s, turn(false, &[], "koban"), InputVia::Voice, "こうばんに行きます");
        assert_eq!(out.go_to.as_deref(), Some("koban"));
    }

    #[test]
    fn suggested_replies_are_three_different_moves_you_can_make() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "ticket_window");
        let say = |jp: &str, en: &str| Phrase { jp: jp.into(), romaji: String::new(), en: en.into() };
        // The police box isn't an exit from the ticket window: neither
        // "I'm going to the kōban" survives; the real way back does.
        take_choices(&story, &mut s, vec![
            say("ありがとうございます。こうばんにいきます。", "Thank you. I will go back to the police box."),
            say("いくらですか。", "How much is it?"),
            say("うえの こうばんに いきます。", "I am going to the kōban upstairs."),
            say("えきに もどります。", "I'll go back to the station."),
            say("えきに いきます。", "I'm going to the station."),
        ]);
        let kept: Vec<&str> = s.choices.iter().map(|c| c.jp.as_str()).collect();
        assert_eq!(kept, vec!["いくらですか。", "えきに もどります。"]);
    }

    #[test]
    fn a_place_the_game_mentions_gets_its_button() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "airport_station");
        s.engaged.insert("hiroshi".into()); // talking with him: a story scene
        assert!(!s.can_go(&story, "koban"));
        let mut t = turn(false, &[], "stay");
        t.lead = "I'm 270 yen short. The kōban is upstairs — Officer Sato's loan should cover it.".into();
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert!(s.can_go(&story, "koban"), "the thought names the police box, so its button opens");
        assert!(!s.can_go(&story, "soba_stand"), "nobody mentioned the soba stand");
    }

    #[test]
    fn nobody_is_held_before_a_conversation_and_being_told_the_way_is_enough() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        // Ueno Park, a return visit: Gen-san is there but nobody's talked.
        s.enter_place(&story, "ueno_park");
        s.enter_place(&story, "ueno_park");
        assert!(s.can_go(&story, "ueno_street"), "walking in and looking around never holds anyone");
        // Aiko says where the guesthouse is: the way to Asakusa opens.
        s.enter_place(&story, "konbini");
        assert!(!s.can_walk(&story, "hostel_lobby"));
        let mut t = turn(false, &[], "stay");
        t.beats = vec![Beat { jp: "あさくさに やすい ホステルが あります。".into(), en: "There's a cheap hostel in Asakusa.".into(), ..Beat::player("") }.with_speaker("aiko")];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert!(s.flags.contains("knows_hostel"));
        assert!(s.can_go(&story, "hostel_lobby"));

        // Told at the konbini, the street can take you there later too.
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "konbini");
        let mut t = turn(false, &[], "stay");
        t.beats = vec![Beat { jp: "あさくさの ホステル さくら。".into(), ..Beat::player("") }.with_speaker("aiko")];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        s.flags.remove("knows_hostel");
        s.enter_place(&story, "ueno_street");
        assert!(s.can_go(&story, "hostel_lobby"), "heard of it earlier: open on arrival");

        // An old save learns it from its past lines.
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "ueno_street");
        assert!(!s.can_walk(&story, "hostel_lobby"));
        let past = vec![Beat { jp: "あさくさに やすい やどが あるよ。".into(), ..Beat::player("") }.with_speaker("gensan")];
        hear_from(&story, &mut s, &past);
        assert!(s.can_walk(&story, "hostel_lobby"));
    }

    #[test]
    fn emily_speaks_english_unless_the_owner_is_listening() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "hostel_lobby");
        s.enter_place(&story, "hostel_lobby");
        let line = || Beat { jp: "はい、ブリスベンです。".into(), romaji: "hai".into(), en: "Yeah, Brisbane! Hot, sunny, lots of parks.".into(), ..Beat::player("") }.with_speaker("emily");
        let out = accept_beats(&story, &mut s, vec![line()], "");
        assert_eq!(out[0].jp, "Yeah, Brisbane! Hot, sunny, lots of parks.");
        assert!(out[0].romaji.is_empty());
        // Mori comes out of his office: his house rule, Japanese.
        let mori = Beat { jp: "うむ。".into(), ..Beat::player("") }.with_speaker("mori");
        let out = accept_beats(&story, &mut s, vec![mori, line()], "");
        assert_eq!(out[1].jp, "はい、ブリスベンです。");
    }

    #[test]
    fn sleepers_in_the_dorm_stay_behind_their_curtains() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "hostel_room");
        let mumble = Beat { jp: "…おやすみ。".into(), speaker_name: "となりのひと".into(), ..Beat::player("") }.with_speaker(EXTRA);
        let out = accept_beats(&story, &mut s, vec![mumble], "");
        assert_eq!(out[0].speaker, EXTRA, "a voice from the next bunk, not a person on stage");
        assert!(s.on_stage.is_empty());
    }

    #[test]
    fn being_told_about_a_place_never_buys_the_ticket() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "ticket_window");
        let mut t = turn(false, &[], "stay");
        t.beats = vec![Beat { jp: "うえのいきの でんしゃは 1ばんせんです。".into(), en: "The train to Ueno is on platform 1.".into(), ..Beat::player("") }.with_speaker("nakajima")];
        apply_turn(&story, &mut s, t, InputVia::Voice, "でんしゃで うえのに いきます");
        assert!(!s.flags.contains("has_ticket"));
        assert!(!s.can_walk(&story, "train_to_ueno"), "no ticket, no train");
    }

    #[test]
    fn what_happens_is_said_and_nobody_gives_before_hearing_how_much() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        // The officer always explains the loan and what to do next.
        s.enter_place(&story, "koban");
        let mut t = turn(false, &[], "stay");
        t.flags_set = vec!["reported_theft".into()];
        // The director explains it all itself too: said once, not twice.
        t.beats = vec![Beat { jp: "はい、届けを書きました。東京の大使館は月曜日までしまっています。千円お貸しします。".into(), en: "Report written. The embassy is closed until Monday. I'll lend you ¥1,000.".into(), ..Beat::player("") }.with_speaker("yumi")];
        let out = apply_turn(&story, &mut s, t, InputVia::Voice, "");
        let said: Vec<&str> = out.beats.iter().filter(|b| b.speaker == "yumi").map(|b| b.en.as_str()).collect();
        assert_eq!(said.iter().filter(|l| l.contains("Monday")).count(), 1, "{said:?}");
        assert!(said.iter().any(|l| l.contains("¥1,000") && l.contains("Pay it back")), "{said:?}");
        assert!(said.iter().any(|l| l.contains("closed until Monday")));
        assert_eq!(s.yen, 1000);
        // Aiko asks how much: no money in that same breath.
        s.enter_place(&story, "narita_exterior");
        let mut t = turn(false, &[], "stay");
        t.beats = vec![Beat { jp: "いくらですか？".into(), en: "How much?".into(), ..Beat::player("") }.with_speaker("aiko")];
        t.flags_set = vec!["aiko_loan".into()];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(s.yen, 1000, "she hasn't heard how much yet");
        let mut t = turn(false, &[], "stay");
        t.beats = vec![Beat { jp: "わかった。".into(), en: "Got it.".into(), ..Beat::player("") }.with_speaker("aiko")];
        t.flags_set = vec!["aiko_loan".into()];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(s.yen, 1500);
        // With the fare known and in hand, buying it is the first option, and
        // nothing claims the old ¥1,000.
        s.enter_place(&story, "ticket_window");
        s.flags.insert("knows_fare".into());
        let mut t = turn(false, &[], "stay");
        t.choices = vec![
            Phrase { jp: "うえのまで、いくらですか。".into(), romaji: String::new(), en: "How much is it to Ueno?".into() },
            Phrase { jp: "せんえんあります。たりませんか。".into(), romaji: String::new(), en: "I have 1,000 yen. Is that not enough?".into() },
        ];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(s.choices[0].en, "One ticket to Ueno, please.");
        // With ¥1,500 in hand, nobody thinks they're still short.
        let mut t = turn(false, &[], "stay");
        t.beats.push(Beat { speaker: THOUGHT.into(), ..Beat::narration("I have ¥1,500 but I'm still ¥270 short.") });
        t.lead = "I'm ¥270 short for the ticket.".into();
        let out = apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert!(!out.beats.iter().any(|b| b.en.contains("short")), "{:?}", out.beats.iter().map(|b| &b.en).collect::<Vec<_>>());
        assert!(!s.choices.iter().any(|c| c.en.contains("1,000")));
    }

    #[test]
    fn the_world_changes_only_by_the_rules() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        // Hiroshi only covers the difference, and only if they have most of it.
        s.enter_place(&story, "airport_station");
        s.yen = 500;
        let mut t = turn(false, &[], "stay");
        t.flags_set = vec!["hiroshi_paid".into()];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(s.yen, 500, "¥500 is nowhere near the fare: he won't");
        assert!(!s.flags.contains("hiroshi_paid"));
        s.yen = 1000;
        let mut t = turn(false, &[], "stay");
        t.flags_set = vec!["hiroshi_paid".into()];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(s.yen, 1270, "exactly the difference, ¥270");
        // The fare is in hand: the money step is done, the other ways close.
        assert!(s.steps_done.contains("escape/money"));
        s.enter_place(&story, "koban");
        let topup = story.place("koban").unwrap().events.iter().find(|e| e.flag == "koban_topup").unwrap();
        assert!(s.event_blocked(&story, topup).is_some(), "no police top-up once you have the fare");
        // The director is told what's possible, and the episode is remembered.
        let msg = director_message(&story, &s, &[], Prompt::Look);
        assert!(msg.contains("Hiroshi covers the difference. Money: ¥1000 → ¥1270."));
        assert!(msg.contains("`koban_topup` [NOT POSSIBLE NOW"));
        s.enter_place(&story, "ticket_window");
        s.flags.extend(["reported_theft".to_string(), "knows_fare".to_string()]);
        s.update_steps(&story);
        assert!(director_message(&story, &s, &[], Prompt::Look).contains("Next step: Buy the ticket."));
        // Buying: only with the money, and the facts say so.
        s.enter_place(&story, "airport_station");
        s.flags.insert("knows_fare".into());
        let msg = director_message(&story, &s, &[], Prompt::Look);
        assert!(msg.contains("Bought the ticket to Ueno costs ¥1270 at Keisei Ticket Window: CAN afford it"));
        s.enter_place(&story, "ticket_window");
        let mut t = turn(false, &[], "stay");
        t.flags_set = vec!["has_ticket".into()];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(s.yen, 0);
        assert!(s.items.contains(&"train_ticket".to_string()));
        assert!(s.steps_done.contains("escape/ticket"));
    }

    #[test]
    fn the_game_says_what_changed_and_nobody_assumes_the_fare() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "koban");
        let mut t = turn(false, &[], "stay");
        t.flags_set = vec!["reported_theft".into()];
        let out = apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(s.yen, 1000);
        assert!(out.beats.iter().any(|b| b.en.starts_with("+¥1,000 · ")), "the loan is shown, not silent");
        // At the station without the fare, the facts say the player doesn't know it.
        s.enter_place(&story, "airport_station");
        let msg = director_message(&story, &s, &[], Prompt::Look);
        assert!(msg.contains("DOESN'T KNOW the price yet"));
        s.flags.insert("knows_fare".into());
        assert!(director_message(&story, &s, &[], Prompt::Look).contains("can't afford it yet: short ¥270"));
    }

    #[test]
    fn leaving_a_words_only_scene_after_talking_finishes_it() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        // Kenji spoke in the intro; the player walks off where he pointed.
        assert!(!s.engaged.is_empty());
        let mut beats = Vec::new();
        assert!(finish_on_leaving(&story, &mut s, &mut beats).is_some());
        assert!(s.goals_done.contains("arrivals_hall"));
        // A goal made of facts never finishes by walking away.
        s.enter_place(&story, "koban");
        s.engaged.insert("yumi".into());
        assert!(finish_on_leaving(&story, &mut s, &mut beats).is_none());
    }

    #[test]
    fn hearing_the_fare_moves_the_objective_on() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.flags.insert("reported_theft".into());
        s.yen = 1000;
        s.enter_place(&story, "ticket_window");
        let mut t = turn(false, &[], "stay");
        t.beats = vec![Beat { jp: "うえの、せんにひゃくななじゅうえんです。".into(), ..Beat::player("") }.with_speaker("nakajima")];
        apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert!(s.flags.contains("knows_fare"), "said aloud is known, event or not");
        assert!(s.items.contains(&"fare_note".to_string()));
        let o = s.objective(&story).unwrap();
        assert_eq!(o.step, "Get ¥1,270 for the ticket", "the fare is known, so the money step is next");
        assert!(o.elsewhere.iter().any(|(w, _)| w == "Police top-up"));
        assert!(o.elsewhere.iter().any(|(w, _)| w == "Hiroshi covers the difference"), "¥1,000 is most of it");
    }

    #[test]
    fn the_first_objective_is_finding_help() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        assert_eq!(s.objective(&story).unwrap().step, "Find out what to do");
        let mut t = turn(false, &[], "stay");
        t.flags_set = vec!["asked_for_help".into()];
        let out = apply_turn(&story, &mut s, t, InputVia::Voice, "");
        assert_eq!(out.steps_done, vec!["Find out what to do".to_string()]);
        assert_eq!(s.objective(&story).unwrap().step, "Report the theft");
    }

    #[test]
    fn beginners_get_more_patience() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "airport_station");
        s.engaged.insert("hiroshi".into()); // the player walked up to him
        assert_eq!(s.difficulty, Difficulty::Beginner);
        let start = s.patience["hiroshi"];
        let mut miss = turn(false, &[], "stay");
        miss.coach.verdict = Verdict::NotUnderstood;
        apply_turn(&story, &mut s, miss, InputVia::Voice, "");
        apply_turn(&story, &mut s, turn(false, &[], "stay"), InputVia::Voice, ""); // a good line
        assert_eq!(s.patience["hiroshi"], start - 1, "a miss costs one, a good line nothing");
    }

    #[test]
    fn a_scene_timer_moves_the_story_on() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        s.enter_place(&story, "train_to_ueno");
        let turns = s.timer_left.expect("the train has a timer");
        let mut last = None;
        for _ in 0..turns {
            let mut t = turn(false, &[], "stay");
            t.coach.verdict = Verdict::Great; // patience holds; only the clock ends it
            last = Some(apply_turn(&story, &mut s, t, InputVia::Voice, ""));
        }
        let out = last.unwrap();
        assert_eq!(out.scene_over.as_deref(), Some("timer"));
        assert_eq!(out.go_to.as_deref(), Some("ueno_street"));
        // Quiet scenes have nobody waiting on the player.
        s.enter_place(&story, "narita_departures");
        assert!(s.patience.is_empty());
    }

    #[test]
    fn named_side_characters_take_their_lines() {
        let story = story();
        // Lines the story wrote for "もりさん" belong to Mori.
        let lobby = story.place("hostel_lobby").unwrap();
        assert!(!lobby.intro.iter().any(|b| b.speaker == EXTRA && story.minor_by_name(&b.speaker_name).is_some()));
        // And so do the director's, wherever he turns up. Strangers get a
        // passer-by's face and keep their name; voices from nowhere stay unseen.
        let (mut s, _) = RunState::new(&story, "Ren".into());
        let line = |name: &str| Beat { jp: "うむ。".into(), speaker_name: name.into(), ..Beat::player("") }.with_speaker(EXTRA);
        let out = accept_beats(&story, &mut s, vec![line("もりさん"), line("えきいん"), line("女の人"), line("アナウンス")], "");
        assert_eq!(out[0].speaker, "mori");
        assert_eq!(out[1].speaker, "folk_station");
        assert_eq!(out[1].speaker_name, "えきいん");
        assert_eq!(out[2].speaker, "folk_officeworker");
        assert_eq!(out[3].speaker, EXTRA);
        // One passer-by on stage at a time.
        assert!(s.on_stage.contains(&"folk_officeworker".to_string()));
        assert!(!s.on_stage.contains(&"folk_station".to_string()));
        // A stranger with no name at all still gets a face.
        let out = accept_beats(&story, &mut s, vec![line("")], "");
        assert!(out[0].speaker.starts_with(TOWNSFOLK_PREFIX));
        // The same stranger keeps the same face.
        assert_eq!(story.townsfolk_for("Taxi guy"), story.townsfolk_for("Taxi guy"));
        // The opening's voice in the dark is Kenji's, not a stranger's.
        let first = &story.place(&story.start_place).unwrap().intro;
        assert!(first.iter().any(|b| b.speaker == EXTRA && b.speaker_name == "???"));
    }

    #[test]
    fn the_most_specific_place_name_wins() {
        let story = Story::load(std::path::Path::new("content/courses/en/story.toml")).expect("en story is valid");
        let (mut s, _) = RunState::new(&story, "Ren".into());
        roam(&story, &mut s, "hostel_lobby_nyc");
        s.flags.extend(["has_bed".to_string(), "has_job".to_string()]);
        assert_eq!(intended_exit(&story, &s, "I'm going to Mr. Russo's room").as_deref(), Some("russo_room"));
        assert_eq!(intended_exit(&story, &s, "ルッソさんのへやにいきます").as_deref(), Some("russo_room"));
        assert_eq!(intended_exit(&story, &s, "I'm going to my room to sleep").as_deref(), Some("hostel_room_nyc"));
    }

    #[test]
    fn saying_where_you_are_going_takes_you_there() {
        let story = story();
        let (mut s, _) = RunState::new(&story, "Ren".into());
        roam(&story, &mut s, "koban");
        assert_eq!(intended_exit(&story, &s, "はい、えきへいきます！").as_deref(), Some("airport_station"));
        assert_eq!(intended_exit(&story, &s, "okay, I'll go to the station now").as_deref(), Some("airport_station"));
        assert_eq!(intended_exit(&story, &s, "駅に行きます").as_deref(), Some("airport_station"));
        // Mentioning a place without going, or a place that isn't an exit, does nothing.
        assert_eq!(intended_exit(&story, &s, "えきはどこですか？"), None);
        assert_eq!(intended_exit(&story, &s, "I'll go to the hostel"), None);
        // Asking the fare, or asking someone to repeat, isn't leaving.
        roam(&story, &mut s, "airport_station");
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
        // The director can't hand out money: the report itself is what pays.
        let mut t = turn(false, &[], "stay");
        t.flags_set = vec!["reported_theft".into()];
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
        roam(&story, &mut s, "ueno_street");
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
        let (mut s, intro) = RunState::new(&story, "Ren".into());
        let msg = director_message(&story, &s, &intro, Prompt::Turn { input: "だいじょうぶです", via: InputVia::Voice });
        assert!(msg.contains("<player_said via=\"voice\">だいじょうぶです</player_said>"));
        // The director sees the world's locks; a story scene only holds the buttons.
        assert!(msg.contains("`koban` — The police box Kenji points to, just outside [OPEN]"));
        assert!(!s.can_go(&story, "koban") && s.can_walk(&story, "koban"));
        s.goals_done.insert(s.place.clone());
        assert!(s.can_go(&story, "koban"));
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
