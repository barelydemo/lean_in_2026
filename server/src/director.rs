//! The story director: the prompt, the structured-output schema and the
//! turn format shared by every LLM provider, plus provider selection
//! (Claude, Groq, or an offline mock) with optional fallback.

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::claude::Claude;
use crate::config::{Config, LlmProvider};
use crate::deepseek::DeepSeek;
use crate::groq::Groq;
use crate::story::{
    Action, Beat, EXTRA, Emote, Expression, NARRATOR, Phrase, Story, Verdict,
};

/// Difficulty tier selected by the learner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Difficulty {
    #[default]
    Beginner,
    Intermediate,
    Advanced,
}

impl Difficulty {
    pub fn system_prompt(self) -> &'static str {
        match self {
            Difficulty::Beginner => {
                "DIFFICULTY TIER: BEGINNER (Shadowing)\n\
                 - Characters speak in shorter, simpler sentences.\n\
                 - Speak more slowly and patiently; repeat or highlight key words clearly.\n\
                 - Forgive minor particle slips (e.g. は/が/を) or slight pronunciation/transcription quirks if the core word is right.\n\
                 - Warmly encourage the player in coaching notes (`coach.note`) and celebrate every effort."
            }
            Difficulty::Intermediate => {
                "DIFFICULTY TIER: INTERMEDIATE (Recall with Reveals)\n\
                 - Characters speak in standard conversational Japanese at a natural everyday pace.\n\
                 - Characters react naturally to how the player phrases things.\n\
                 - In `coach`, strictly evaluate particles (`が`, `を`, `に`, `で`, `は`, `へ`) and sentence connection.\n\
                 - Point out particle or conjugation slips in `coach.note` and always provide the clean correction in `better_jp`."
            }
            Difficulty::Advanced => {
                "DIFFICULTY TIER: ADVANCED (Full Immersion)\n\
                 - Characters speak at native conversational speed using natural colloquial Japanese, idioms, contractions, and polite keigo where appropriate to their role.\n\
                 - Do not artificially simplify sentences unless the character is repeating something after a misunderstanding.\n\
                 - In `coach`, apply strict evaluation on nuance, register (keigo vs. casual), and natural phrasing.\n\
                 - Only award `great` when the player's phrasing, particles, and register sound genuinely natural for the situation."
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Coach {
    pub verdict: Verdict,
    pub note: String,
    pub better_jp: String,
    pub better_romaji: String,
    pub better_en: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TrustChange {
    pub character: String,
    pub delta: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StateChange {
    pub yen_delta: i64,
    pub items_gained: Vec<String>,
    pub items_lost: Vec<String>,
    pub trust: Vec<TrustChange>,
}

/// What Claude returns for one turn. Everything here is untrusted until
/// `game::apply_turn` has validated and clamped it.
#[derive(Debug, Clone, Deserialize)]
pub struct DirectorTurn {
    pub coach: Coach,
    pub grammar_used: Vec<String>,
    pub beats: Vec<Beat>,
    pub choices: Vec<Phrase>,
    pub state: StateChange,
    pub new_phrases: Vec<Phrase>,
    pub objective_complete: bool,
    /// An exit id the player is walking through, or "stay".
    pub go_to: String,
    /// Story events from this place's list that happened this turn.
    pub flags_set: Vec<String>,
    pub journal: String,
}


enum Backend {
    Claude(Claude),
    Groq(Groq),
    DeepSeek(DeepSeek),
    Mock,
}

impl Backend {
    fn name(&self) -> &'static str {
        match self {
            Backend::Claude(_) => "claude",
            Backend::Groq(_) => "groq",
            Backend::DeepSeek(_) => "deepseek",
            Backend::Mock => "mock",
        }
    }

    async fn turn(&self, system: &[&str], user: &str, schema: &Value) -> anyhow::Result<DirectorTurn> {
        let text = match self {
            Backend::Claude(c) => c.complete_json(system, user, schema).await?,
            Backend::Groq(g) => g.complete_json(system, user, schema).await?,
            Backend::DeepSeek(d) => d.complete_json(system, user, schema).await?,
            Backend::Mock => return Ok(mock_turn(user)),
        };
        serde_json::from_str(&text).context("director output did not match the schema")
    }

    async fn translate(&self, user: &str, schema: &Value, system: &str, lesson_brief: &str) -> anyhow::Result<Translation> {
        let text = match self {
            Backend::Claude(c) => c.complete_json(&[system, lesson_brief], user, schema).await?,
            Backend::Groq(g) => g.complete_json(&[system, lesson_brief], user, schema).await?,
            Backend::DeepSeek(d) => d.complete_json(&[system, lesson_brief], user, schema).await?,
            Backend::Mock => {
                return Ok(Translation {
                    jp: "すみません、たすけてください。".into(),
                    romaji: "Sumimasen, tasukete kudasai.".into(),
                    en: "Excuse me, please help me.".into(),
                    words: mock_gloss("すみません、たすけてください").words,
                });
            }
        };
        serde_json::from_str(&text).context("translation did not match the schema")
    }

    async fn gloss(&self, jp: &str, schema: &Value, system: &str, grammar: &str) -> anyhow::Result<Gloss> {
        let user = format!("<line>{jp}</line>");
        let text = match self {
            Backend::Claude(c) => c.complete_json(&[system, grammar], &user, schema).await?,
            Backend::Groq(g) => g.complete_json(&[system, grammar], &user, schema).await?,
            Backend::DeepSeek(d) => d.complete_json(&[system, grammar], &user, schema).await?,
            Backend::Mock => return Ok(mock_gloss(jp)),
        };
        serde_json::from_str(&text).context("gloss did not match the schema")
    }
}

/// Directs each turn through the primary provider, retrying once on the
/// fallback provider if the primary fails.
pub struct Director {
    primary: Backend,
    fallback: Option<Backend>,
    world_prompt: String,
    schema: Value,
    gloss_schema: Value,
    gloss_grammar: String,
    gloss_system: String,
    translate_schema: Value,
    translate_system: String,
}

impl Director {
    pub fn new(cfg: &Config, story: &Story) -> anyhow::Result<Self> {
        let build = |p: LlmProvider| -> anyhow::Result<Backend> {
            Ok(match p {
                LlmProvider::Claude => Backend::Claude(Claude::new(cfg)?),
                LlmProvider::Groq => Backend::Groq(Groq::new(cfg)?),
                LlmProvider::DeepSeek => Backend::DeepSeek(DeepSeek::new(cfg)?),
                LlmProvider::Mock => Backend::Mock,
            })
        };
        let primary = build(cfg.llm_provider)?;
        let fallback = cfg.llm_fallback.map(build).transpose()?;
        tracing::info!(primary = primary.name(), fallback = fallback.as_ref().map(Backend::name), "director ready");
        Ok(Director {
            primary,
            fallback,
            world_prompt: world_prompt(story),
            schema: turn_schema(story),
            gloss_schema: gloss_schema(story.all_grammar_ids()),
            gloss_grammar: gloss_grammar_list(story),
            translate_schema: translate_schema(story.all_grammar_ids()),
            gloss_system: gloss_system(&story.course),
            translate_system: translate_system(&story.course),
        })
    }

    /// One director call: the cached world prompt, the cached lesson brief,
    /// difficulty guidelines, then the per-turn message (state, place, exits, transcript, input).
    pub async fn direct_turn(&self, lesson_brief: &str, difficulty: Difficulty, user_message: &str) -> anyhow::Result<DirectorTurn> {
        let diff_prompt = difficulty.system_prompt();
        let system = [self.world_prompt.as_str(), lesson_brief, diff_prompt];
        match self.primary.turn(&system, user_message, &self.schema).await {
            Ok(t) => Ok(t),
            Err(e) => match &self.fallback {
                Some(fb) => {
                    tracing::warn!(error = %e, primary = self.primary.name(), fallback = fb.name(), "director falling back");
                    fb.turn(&system, user_message, &self.schema).await
                }
                None => Err(e),
            },
        }
    }
}


// ── the electronic dictionary: word-by-word map ───────────────────────────

/// What kind of piece a word is, so the player learns sentence structure.
pub const WORD_KINDS: &[&str] = &[
    "noun", "verb", "adjective", "adverb", "particle", "copula", "question", "expression", "name", "number", "other",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlossWord {
    pub jp: String,
    pub romaji: String,
    /// Dictionary meaning (1-4 words), or the particle's job.
    pub en: String,
    pub kind: String,
    /// One short teaching note for particles, endings and set phrases; else "".
    pub note: String,
    /// The curriculum grammar point this piece belongs to, or "none".
    pub grammar_id: String,
}

/// A line broken into dictionary entries. Deliberately no sentence
/// translation: it's a 1998 dictionary, and putting it together is the lesson.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gloss {
    pub words: Vec<GlossWord>,
}

/// The dictionary's look-up instructions, for a course.
fn gloss_system(c: &crate::story::Course) -> String {
    let split_rule = if c.target_lang == "ja" {
        "content words (verbs keep their ます／ました endings), the copula です／でした as its own entry, and particles (は, が, を, に, で, の, も, か, よ, ね…) as separate entries"
    } else {
        "single words, keeping fixed phrases together (\"excuse me\", \"thank you\", \"how much\"); articles and prepositions are their own entries"
    };
    format!(
        "You are a 1998 electronic {tl}–{ll} dictionary helping a complete beginner decode one line of spoken {tl}. \
Split the line into dictionary entries in order: {split_rule}. Drop punctuation. Cover every part of the line. \
For each entry give: jp = the {tl} exactly as written; romaji = the {read}; en = a short {ll} dictionary meaning (1-4 words) or, for a grammar word, its job; kind; note = one plain {ll} sentence a beginner needs for grammar words, endings and set phrases (else \"\"); grammar_id = the matching curriculum id when the entry is an example of it, else \"none\". \
Do not translate the whole sentence. Output only the JSON.",
        tl = c.target_name,
        ll = c.learner_name,
        read = c.reading,
    )
}

fn gloss_schema(grammar_ids: Vec<&str>) -> Value {
    let s = json!({ "type": "string" });
    let mut ids = vec!["none"];
    ids.extend(grammar_ids);
    obj(json!({
        "words": { "type": "array", "items": obj(json!({
            "jp": s, "romaji": s, "en": s,
            "kind": str_enum(WORD_KINDS.to_vec()),
            "note": s,
            "grammar_id": str_enum(ids),
        })) },
    }))
}

/// The curriculum list the dictionary can point at, appended to its prompt.
fn gloss_grammar_list(story: &Story) -> String {
    let lines: Vec<String> = story
        .lessons
        .iter()
        .flat_map(|l| l.grammar.iter().map(|g| format!("{} = {} ({})", g.id, g.pattern, g.meaning)))
        .collect();
    format!("Curriculum grammar ids:\n{}", lines.join("\n"))
}

impl Director {
    /// Word-by-word gloss of one Japanese line for the translator device.
    pub async fn gloss(&self, jp: &str) -> anyhow::Result<Gloss> {
        match self.primary.gloss(jp, &self.gloss_schema, &self.gloss_system, &self.gloss_grammar).await {
            Ok(g) => Ok(g),
            Err(e) => match &self.fallback {
                Some(fb) => {
                    tracing::warn!(error = %e, "gloss falling back");
                    fb.gloss(jp, &self.gloss_schema, &self.gloss_system, &self.gloss_grammar).await
                }
                None => Err(e),
            },
        }
    }
}

fn mock_gloss(jp: &str) -> Gloss {
    let words = jp
        .split(['、', '。', '！', '？', '…', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| GlossWord {
            jp: w.into(),
            romaji: "(mock)".into(),
            en: "(meaning)".into(),
            kind: "other".into(),
            note: String::new(),
            grammar_id: "none".into(),
        })
        .collect();
    Gloss { words }
}


// ── the electronic dictionary: English → Japanese phrases ─────────────────

/// "How do I say…?" — what the player wants to say, ready to read aloud.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Translation {
    pub jp: String,
    pub romaji: String,
    /// The Japanese back in plain English, so the player knows what they'll say.
    pub en: String,
    pub words: Vec<GlossWord>,
}

/// The dictionary's "how do I say…?" instructions, for a course.
fn translate_system(c: &crate::story::Course) -> String {
    let register = if c.target_lang == "ja" {
        "です／ます style, mostly kana with only very common kanji"
    } else {
        "polite, simple everyday English (please / thank you), short words"
    };
    format!(
        "You are the phrase function of a 1998 electronic {tl}–{ll} dictionary, used by a complete beginner who is lost abroad. \
The player tells you, in {ll} (or broken {tl}), what they want to say to someone. Give them ONE short, natural, polite {tl} sentence they can read aloud: {register}, the simplest grammar that gets the meaning across, preferring the grammar listed for their current and earlier lessons. \
romaji: the {read}. en: what the {tl} says, in plain {ll}. words: the sentence broken into dictionary entries (each with a short {ll} meaning, kind, a teaching note for grammar words, and the matching curriculum grammar_id or \"none\"). \
If the request isn't something to say, translate it as best you can anyway. Output only the JSON.",
        tl = c.target_name,
        ll = c.learner_name,
        read = c.reading,
    )
}

fn translate_schema(grammar_ids: Vec<&str>) -> Value {
    let s = json!({ "type": "string" });
    let mut ids = vec!["none"];
    ids.extend(grammar_ids);
    obj(json!({
        "jp": s,
        "romaji": s,
        "en": s,
        "words": { "type": "array", "items": obj(json!({
            "jp": s, "romaji": s, "en": s,
            "kind": str_enum(WORD_KINDS.to_vec()),
            "note": s,
            "grammar_id": str_enum(ids),
        })) },
    }))
}

impl Director {
    /// English → a Japanese line the player can say, with its word map.
    pub async fn translate(&self, want: &str, lesson_brief: &str) -> anyhow::Result<Translation> {
        let user = format!("<want_to_say>{want}</want_to_say>");
        match self.primary.translate(&user, &self.translate_schema, &self.translate_system, lesson_brief).await {
            Ok(t) => Ok(t),
            Err(e) => match &self.fallback {
                Some(fb) => {
                    tracing::warn!(error = %e, "translate falling back");
                    fb.translate(&user, &self.translate_schema, &self.translate_system, lesson_brief).await
                }
                None => Err(e),
            },
        }
    }
}

/// Offline stand-in for the director: a plausible turn that exercises the
/// stage cues, completes the place's goal after a couple of turns, and
/// walks through an open exit when the player says they'll go.
fn mock_turn(user_message: &str) -> DirectorTurn {
    let turn: u32 = user_message
        .split("turn ")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .and_then(|n| n.parse().ok())
        .unwrap_or(1);
    let said = user_message.rsplit("\">").next().unwrap_or("").trim_end_matches("</player_said>");
    let grammar = user_message
        .split("not yet: ")
        .nth(1)
        .and_then(|s| s.split('\n').next())
        .map(|s| s.split(", ").filter(|g| *g != "none").take(1).map(String::from).collect())
        .unwrap_or_default();
    // "いきます" / "go" walks through the first OPEN exit.
    let wants_to_go = said.contains("いき") || said.to_lowercase().contains("go");
    let go_to = user_message
        .lines()
        .filter(|l| l.ends_with("[OPEN]"))
        .find_map(|l| l.split('`').nth(1))
        .filter(|_| wants_to_go && !user_message.contains("<arrival"))
        .unwrap_or("stay")
        .to_string();
    let speaker = user_message
        .split("on stage: ")
        .nth(1)
        .and_then(|s| s.split(['\n', ',']).next())
        .filter(|s| *s != "nobody")
        .unwrap_or("narrator")
        .to_string();
    let beat = |speaker: &str, expression: Expression, emote: Emote, action: Action, jp: &str, romaji: &str, en: &str| Beat {
        speaker: speaker.into(),
        expression,
        emote,
        action,
        jp: jp.into(),
        romaji: romaji.into(),
        en: en.into(),
        ..Beat::narration("")
    };
    DirectorTurn {
        coach: Coach {
            verdict: Verdict::Understood,
            note: format!("(mock) I heard: {said}"),
            better_jp: "はい、だいじょうぶです。".into(),
            better_romaji: "Hai, daijoubu desu.".into(),
            better_en: "Yes, I'm okay.".into(),
        },
        grammar_used: grammar,
        beats: vec![
            beat(&speaker, Expression::Surprised, Emote::Exclaim, Action::Hop, "えっ、ほんとう？", "e, hontou?", "Huh, really?"),
            beat(NARRATOR, Expression::default(), Emote::default(), Action::default(), "", "", "They look at you, thinking hard."),
            beat(&speaker, Expression::Happy, Emote::Sparkle, Action::Nod, "わかりました！だいじょうぶ！", "wakarimashita! daijoubu!", "Got it! It's okay!"),
        ],
        choices: vec![
            Phrase { jp: "ありがとうございます。".into(), romaji: "Arigatou gozaimasu.".into(), en: "Thank you.".into() },
            Phrase { jp: "すみません、もういちど。".into(), romaji: "Sumimasen, mou ichido.".into(), en: "Sorry, once more.".into() },
            Phrase { jp: "わかりません…".into(), romaji: "Wakarimasen…".into(), en: "I don't understand…".into() },
        ],
        state: StateChange { yen_delta: 0, items_gained: vec![], items_lost: vec![], trust: vec![] },
        new_phrases: vec![],
        objective_complete: turn >= 3 && !user_message.contains("ALREADY ACHIEVED") && !user_message.contains("<arrival"),
        go_to,
        flags_set: vec![],
        journal: "Today I learned that a few words, said bravely, go a long way.".into(),
    }
}

// ── prompt ─────────────────────────────────────────────────────────────────

fn world_prompt(story: &Story) -> String {
    let c = &story.course;
    let (tl, ll, read) = (c.target_name.as_str(), c.learner_name.as_str(), c.reading.as_str());
    let mut cast = String::new();
    for m in &story.cast {
        let words = if m.english_words.is_empty() { "none".to_string() } else { m.english_words.join(", ") };
        cast.push_str(&format!(
            "- `{}`: {} ({}), {}. Role: {}. Style: {}. Allowed {ll}: {}\n",
            m.id, m.name_jp, m.name, m.age, m.role, m.speech_style, words
        ));
    }
    let mut scenes = String::new();
    for sc in &story.scenes {
        scenes.push_str(&format!("`{}` ({}), ", sc.id, sc.name));
    }

    format!(
        r#"You are the director, narrator and every character of "{title}" ({title_jp}), a voice-driven visual novel that teaches beginner {tl} to a {ll} speaker. The player talks to characters out loud (speech-to-text input) or picks suggested replies.

LANGUAGES IN THIS GAME
- Characters speak {tl} (`jp`), with a {read} reading aid (`romaji`) and a {ll} translation (`en`).
- Every character beat's `en` is the {ll} translation of THAT beat's own `jp` line — never a copy of the player's words.
- Narration beats leave `jp` and `romaji` empty and put the narration in `en`.
- Coaching notes, journal, and player thoughts are in {ll}.

PREMISE
{premise}

IMMERSION & TEACHING RULES
- Characters never translate whole sentences into {ll}. They speak natural, kind beginner {tl} (1–2 short sentences per beat).
- They help through gestures, pointing, miming, and numbers (describe these in narrator beats).
- Meaning first: if a character understands the gist from broken {tl}, cognates or gestures, ACT ON IT and advance the scene. Never turn scenes into drills or ask the player to repeat themselves once understood.
- Seed the current place's KEY WORDS early in character speech so the player hears them before speaking them.
- If the player is in HINT MODE, naturally borrow the needed phrase in character dialogue.
- Corrections go privately in `coach`.

CAST
{cast}
SCENE IDS
{scenes}

STAGING
- Every beat MUST include all fields: speaker, speaker_name, expression, action, emote, camera, transition, ambient, sfx, scene, jp, romaji, en.
- Allowed values:
  - action: "none", "enter_left", "enter_right", "exit_left", "exit_right", "hop", "nod", "shake_head", "tremble", "lean_in", "bow", "turn_away", "point_left", "point_right", "point", "hand", "wave".
  - expression: "neutral", "happy", "worried", "surprised", "thinking", "annoyed", "embarrassed", "sad".
  - emote: "none", "sparkle", "sweat", "heart", "anger", "question", "exclaim", "blush", "music", "gloom".
  - camera: "none", "shake", "zoom_in", "zoom_out", "pan_left", "pan_right", "tilt_blur".
  - transition: "none", "fade", "crossfade", "flash", "blackout", "wake", "whip".
  - ambient: "keep", "clear", "rain", "snow", "petals", "night_bokeh", "dust".
  - sfx: "none", "door_chime", "train_doors", "radio", "phone", "stamp", "coins", "footsteps", "thud", "whoosh", "bell".
  - scene: always "keep".
- Use speaker: cast id; "{narrator}" for narration; or "{extra}" with speaker_name set for minor characters.

OPEN WORLD
- Each turn gives the current place: situation, goal, open/locked exits, and events.
- When the player chooses or speaks to head to an OPEN exit, set `go_to` to that exit id this turn. Otherwise "stay".
- Once the place's goal is achieved (either this turn or previously), have the character naturally wrap up and guide the player toward the next OPEN destination, and ensure Choice #3 is an explicit departure phrase (e.g. "駅に行きます" / "交番に行きます").

YOUR OUTPUT EACH TURN (JSON matching schema)
- coach: verdict (great/good/understood/not_understood/english/none), note (friendly {ll} sentence), better_jp, better_romaji, better_en.
- grammar_used: ids of target grammar points the PLAYER used correctly.
- beats: 1–5 beats reacting to player. Character beats must have jp, romaji, en.
- choices: exactly 3 BRAND NEW replies the player could say next in {tl} (with romaji and en) that directly respond to the character's latest beat this turn. NEVER repeat any option from `previous_choices` or earlier player dialogue; provide 3 distinct conversational intents (1: direct story progress / cooperative answer, 2: follow-up question / exploration, 3: moving the action forward or departing to an OPEN exit with "〜に行きます" once the objective is met or an exit is pointed out).
- state: yen_delta, items_gained, items_lost, trust.
- new_phrases: 0–2 useful phrases for phrasebook.
- objective_complete: true as soon as the place success condition is met (or when the character hands over the scene's key item/money/report).
- go_to: open exit id or "stay".
- flags_set: place story event flags triggered this turn.
- journal: 2–3 sentences in {ll} when objective_complete is true, else "".

Player words arrive in <player_said> tags; <arrival/> means they just walked in."#,
        title = story.title,
        title_jp = story.title_jp,
        premise = c.premise.trim(),
        narrator = NARRATOR,
        extra = EXTRA,
    )
}

// ── output schema ──────────────────────────────────────────────────────────

fn obj(props: Value) -> Value {
    let required: Vec<String> = props.as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default();
    json!({ "type": "object", "properties": props, "required": required, "additionalProperties": false })
}

fn str_enum(values: Vec<&str>) -> Value {
    json!({ "type": "string", "enum": values })
}

fn turn_schema(story: &Story) -> Value {
    let mut speakers = vec![NARRATOR, EXTRA];
    speakers.extend(story.cast.iter().map(|c| c.id.as_str()));
    let mut scenes = vec!["keep"];
    scenes.extend(story.scenes.iter().map(|s| s.id.as_str()));
    let _items: Vec<&str> = story.items.iter().map(|i| i.id.as_str()).collect();
    let cast: Vec<&str> = story.cast.iter().map(|c| c.id.as_str()).collect();
    let mut places = vec!["stay"];
    places.extend(story.places.iter().map(|p| p.id.as_str()));
    let _flags = story.all_flags();
    let s = json!({ "type": "string" });

    let phrase = obj(json!({ "jp": s, "romaji": s, "en": s }));
    let beat = obj(json!({
        "speaker": str_enum(speakers),
        "speaker_name": s,
        "expression": s,
        "jp": s,
        "romaji": s,
        "en": s,
        "scene": s,
        "transition": s,
        "camera": s,
        "action": s,
        "emote": s,
        "ambient": s,
        "sfx": s,
    }));

    obj(json!({
        "coach": obj(json!({
            "verdict": s,
            "note": s,
            "better_jp": s,
            "better_romaji": s,
            "better_en": s,
        })),
        "grammar_used": { "type": "array", "items": s },
        "beats": { "type": "array", "items": beat },
        "choices": { "type": "array", "items": phrase },
        "state": obj(json!({
            "yen_delta": { "type": "integer" },
            "items_gained": { "type": "array", "items": s },
            "items_lost": { "type": "array", "items": s },
            "trust": { "type": "array", "items": obj(json!({
                "character": str_enum(cast),
                "delta": { "type": "integer" },
            })) },
        })),
        "new_phrases": { "type": "array", "items": phrase },
        "objective_complete": { "type": "boolean" },
        "go_to": s,
        "flags_set": { "type": "array", "items": s },
        "journal": s,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_objects_are_closed_and_fully_required() {
        let story = Story::load(std::path::Path::new("content/courses/ja/story.toml")).unwrap();
        fn walk(v: &Value) {
            if v["type"] == "object" {
                assert_eq!(v["additionalProperties"], false);
                let props = v["properties"].as_object().unwrap();
                assert_eq!(v["required"].as_array().unwrap().len(), props.len());
                props.values().for_each(walk);
            }
            if let Some(items) = v.get("items") {
                walk(items);
            }
        }
        walk(&turn_schema(&story));
    }

    #[test]
    fn sample_output_parses() {
        let raw = r#"{"coach":{"verdict":"understood","note":"Nice!","better_jp":"","better_romaji":"","better_en":""},
          "grammar_used":["g0_daijoubu"],
          "beats":[{"speaker":"kenji","speaker_name":"","expression":"happy","jp":"よかった！","romaji":"yokatta!","en":"Thank goodness!",
                    "scene":"keep","transition":"none","camera":"none","action":"nod","emote":"sparkle","ambient":"keep"}],
          "choices":[{"jp":"はい","romaji":"hai","en":"yes"}],
          "state":{"yen_delta":0,"items_gained":[],"items_lost":[],"trust":[{"character":"kenji","delta":1}]},
          "new_phrases":[],"objective_complete":false,"go_to":"stay","flags_set":[],"journal":""}"#;
        let t: DirectorTurn = serde_json::from_str(raw).unwrap();
        assert_eq!(t.beats[0].emote, Emote::Sparkle);
        assert_eq!(t.coach.verdict, Verdict::Understood);
    }

    #[test]
    fn world_prompt_is_deterministic_for_caching() {
        let story = Story::load(std::path::Path::new("content/courses/ja/story.toml")).unwrap();
        assert_eq!(world_prompt(&story), world_prompt(&story));
        assert!(!world_prompt(&story).contains("{"), "unfilled template placeholder");
    }

    #[test]
    fn difficulty_tiers_produce_distinct_system_guidelines() {
        assert!(Difficulty::Beginner.system_prompt().contains("BEGINNER"));
        assert!(Difficulty::Intermediate.system_prompt().contains("INTERMEDIATE"));
        assert!(Difficulty::Advanced.system_prompt().contains("ADVANCED"));
        assert!(Difficulty::Intermediate.system_prompt().contains("particles"));
        assert!(Difficulty::Advanced.system_prompt().contains("keigo"));
    }
}
