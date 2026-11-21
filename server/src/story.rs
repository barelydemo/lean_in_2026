//! Story content: cast, scenes, chapters and the curriculum, loaded from
//! `content/story.toml`, plus the closed vocabulary of stage cues the web
//! client knows how to animate.

use std::collections::HashSet;
use std::path::Path;

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};

/// Defines a fieldless enum that (de)serializes as snake_case strings and
/// exposes its variants as strings, so the same list drives parsing, the
/// JSON schema we hand to Claude, and the web client's animation presets.
/// Resilient: unknown or synonymous strings fall back gracefully rather than crashing.
macro_rules! string_enum {
    ($name:ident { $($variant:ident => $s:literal),+ $(,)? } default $default:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
        pub enum $name {
            #[default]
            $default,
            $($variant),+
        }

        impl serde::Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: serde::Serializer,
            {
                serializer.serialize_str(self.as_str())
            }
        }

        impl<'de> serde::Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                let s = String::deserialize(deserializer)?;
                Ok(Self::from_str_loose(&s))
            }
        }

        impl $name {
            #[allow(dead_code)]
            pub fn names() -> Vec<&'static str> {
                let mut v = vec![Self::$default.as_str()];
                v.extend([$($s),+]);
                v
            }

            pub fn as_str(self) -> &'static str {
                match self {
                    Self::$default => stringify!($default),
                    $(Self::$variant => $s),+
                }
            }

            pub fn from_str_loose(raw: &str) -> Self {
                let clean = raw.trim().to_lowercase().replace('-', "_");
                match clean.as_str() {
                    stringify!($default) => Self::$default,
                    $($s => Self::$variant,)+
                    _ => Self::map_synonym(&clean).unwrap_or(Self::$default),
                }
            }

            #[allow(dead_code)]
            pub fn is_default(&self) -> bool {
                *self == Self::$default
            }
        }
    };
}

// The default variants serialize as their (lowercase) identifier.
#[allow(non_camel_case_types)]
mod cues {

    string_enum!(Expression {
        Happy => "happy", Worried => "worried", Surprised => "surprised",
        Thinking => "thinking", Annoyed => "annoyed", Embarrassed => "embarrassed", Sad => "sad",
    } default neutral);

    impl Expression {
        fn map_synonym(s: &str) -> Option<Self> {
            match s {
                "smiling" | "smile" | "grin" | "grinning" | "laugh" | "laughing" | "cheerful" | "joy" | "warm" => Some(Self::Happy),
                "confused" | "pondering" | "wondering" | "curious" | "questioning" => Some(Self::Thinking),
                "frown" | "frowning" | "crying" | "upset" | "weeping" | "gloomy" => Some(Self::Sad),
                "angry" | "mad" | "irritated" | "furious" | "stern" => Some(Self::Annoyed),
                "shocked" | "gasp" | "stunned" | "wide_eyed" => Some(Self::Surprised),
                "anxious" | "nervous" | "scared" | "fear" | "tense" => Some(Self::Worried),
                "blushing" | "shy" | "flustered" | "sheepish" => Some(Self::Embarrassed),
                _ => None,
            }
        }
    }

    string_enum!(Transition {
        Fade => "fade", Crossfade => "crossfade", Flash => "flash",
        Blackout => "blackout", Wake => "wake", Whip => "whip",
    } default none);

    impl Transition {
        fn map_synonym(_s: &str) -> Option<Self> { None }
    }

    string_enum!(Camera {
        Shake => "shake", ZoomIn => "zoom_in", ZoomOut => "zoom_out",
        PanLeft => "pan_left", PanRight => "pan_right", TiltBlur => "tilt_blur",
    } default none);

    impl Camera {
        fn map_synonym(s: &str) -> Option<Self> {
            match s {
                "zoom" => Some(Self::ZoomIn),
                _ => None,
            }
        }
    }

    string_enum!(Action {
        EnterLeft => "enter_left", EnterRight => "enter_right",
        ExitLeft => "exit_left", ExitRight => "exit_right",
        Hop => "hop", Nod => "nod", ShakeHead => "shake_head", Tremble => "tremble",
        LeanIn => "lean_in", Bow => "bow", TurnAway => "turn_away",
        PointLeft => "point_left", PointRight => "point_right", Point => "point",
        Hand => "hand", Wave => "wave",
    } default none);

    impl Action {
        fn map_synonym(s: &str) -> Option<Self> {
            match s {
                "hand" | "handing" | "give" | "giving" | "pass" | "offer" | "offering" => Some(Self::Hand),
                "wave" | "waving" | "greet" | "farewell" => Some(Self::Wave),
                "nod" | "nodding" | "agree" => Some(Self::Nod),
                "shake_head" | "shaking_head" | "shake" | "disagree" => Some(Self::ShakeHead),
                "point" | "pointing" | "indicate" => Some(Self::Point),
                "point_left" | "pointing_left" => Some(Self::PointLeft),
                "point_right" | "pointing_right" => Some(Self::PointRight),
                "bow" | "bowing" => Some(Self::Bow),
                "lean_in" | "leaning_in" | "lean" => Some(Self::LeanIn),
                "turn_away" | "turning_away" => Some(Self::TurnAway),
                "tremble" | "trembling" | "shiver" => Some(Self::Tremble),
                "hop" | "jump" => Some(Self::Hop),
                _ => None,
            }
        }
    }

    string_enum!(Emote {
        Sparkle => "sparkle", Sweat => "sweat", Heart => "heart", Anger => "anger",
        Question => "question", Exclaim => "exclaim", Blush => "blush",
        Music => "music", Gloom => "gloom",
    } default none);

    impl Emote {
        fn map_synonym(s: &str) -> Option<Self> {
            match s {
                "sparkles" => Some(Self::Sparkle),
                "drops" | "sweat_drop" => Some(Self::Sweat),
                "hearts" => Some(Self::Heart),
                "music_note" | "note" => Some(Self::Music),
                _ => None,
            }
        }
    }

    string_enum!(Ambient {
        Clear => "clear", Rain => "rain", Snow => "snow", Petals => "petals",
        NightBokeh => "night_bokeh", Dust => "dust",
    } default keep);

    impl Ambient {
        fn map_synonym(_s: &str) -> Option<Self> { None }
    }

    // Sound cues. Ids must match `[[audio.sfx]]` in story.toml and the
    // client's synthesised fallbacks in web/lib/audio/sfx.ts.
    string_enum!(Sfx {
        DoorChime => "door_chime", TrainDoors => "train_doors", Radio => "radio",
        Phone => "phone", Stamp => "stamp", Coins => "coins", Footsteps => "footsteps",
        Thud => "thud", Whoosh => "whoosh", Bell => "bell",
    } default none);

    impl Sfx {
        fn map_synonym(_s: &str) -> Option<Self> { None }
    }

    string_enum!(Verdict {
        Great => "great", Good => "good", Understood => "understood",
        NotUnderstood => "not_understood", English => "english",
    } default none);

    impl Verdict {
        fn map_synonym(s: &str) -> Option<Self> {
            match s {
                "great" | "excellent" | "perfect" | "master" => Some(Self::Great),
                "good" | "nice" | "pass" | "correct" => Some(Self::Good),
                "understood" | "ok" | "okay" | "fair" => Some(Self::Understood),
                "not_understood" | "fail" | "incorrect" | "wrong" | "miss" => Some(Self::NotUnderstood),
                "english" | "en" => Some(Self::English),
                _ => None,
            }
        }
    }
}

pub use cues::*;

/// Who speaks a beat. Besides cast ids there are three special speakers.
pub const NARRATOR: &str = "narrator";
pub const EXTRA: &str = "extra";
pub const PLAYER: &str = "you";
/// Townsfolk ids start with this, so the stage can swap one passer-by for the next.
pub const TOWNSFOLK_PREFIX: &str = "folk_";
/// The player's own inner monologue: first person, in the learner's language.
pub const THOUGHT: &str = "thought";

/// Narration and thought: lines nobody says out loud.
pub fn is_inner(speaker: &str) -> bool {
    speaker == NARRATOR || speaker == THOUGHT
}

/// One step of the visual novel: a line of dialogue or narration plus the
/// stage cues that play with it. Used for authored intros and for
/// everything Claude writes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Beat {
    pub speaker: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub speaker_name: String,
    #[serde(default, skip_serializing_if = "Expression::is_default")]
    pub expression: Expression,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub jp: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub romaji: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub en: String,
    /// Scene id to cut to; empty (or "keep") stays in the current scene.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub scene: String,
    #[serde(default, skip_serializing_if = "Transition::is_default")]
    pub transition: Transition,
    #[serde(default, skip_serializing_if = "Camera::is_default")]
    pub camera: Camera,
    #[serde(default, skip_serializing_if = "Action::is_default")]
    pub action: Action,
    #[serde(default, skip_serializing_if = "Emote::is_default")]
    pub emote: Emote,
    #[serde(default, skip_serializing_if = "Ambient::is_default")]
    pub ambient: Ambient,
    #[serde(default, skip_serializing_if = "Sfx::is_default")]
    pub sfx: Sfx,
    /// People who quietly come into view with this beat: here, going about
    /// their own business, not (yet) talking to the player.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enter: Vec<String>,
}

impl Beat {
    pub fn player(text: &str) -> Self {
        Beat { jp: text.into(), ..Self::empty(PLAYER) }
    }

    pub fn narration(text: &str) -> Self {
        Beat { en: text.into(), ..Self::empty(NARRATOR) }
    }

    fn empty(speaker: &str) -> Self {
        Beat {
            speaker: speaker.into(),
            speaker_name: String::new(),
            expression: Expression::default(),
            jp: String::new(),
            romaji: String::new(),
            en: String::new(),
            scene: String::new(),
            transition: Transition::default(),
            camera: Camera::default(),
            action: Action::default(),
            emote: Emote::default(),
            ambient: Ambient::default(),
            sfx: Sfx::default(),
            enter: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phrase {
    pub jp: String,
    pub romaji: String,
    pub en: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct CastMember {
    pub id: String,
    pub name: String,
    pub name_jp: String,
    pub role: String,
    #[serde(skip_serializing)]
    pub age: u32,
    pub sprite: String,
    pub color: String,
    /// Default ElevenLabs voice id; overridable per character via env.
    #[serde(skip_serializing)]
    pub voice: String,
    #[serde(default, skip_serializing)]
    pub english: String,
    #[serde(skip_serializing)]
    pub looks: String,
    #[serde(skip_serializing)]
    pub personality: String,
    #[serde(default, skip_serializing)]
    pub speech_style: String,
    #[serde(default, skip_serializing)]
    pub backstory: String,
    /// How they get meaning across to someone with no Japanese.
    #[serde(default, skip_serializing)]
    pub helps: String,
    /// The only English they can produce.
    #[serde(default, skip_serializing)]
    pub english_words: Vec<String>,
    /// Turns of patience in a scene before they have to go: busy people run
    /// out fast, kind ones wait. Misunderstandings cost extra.
    #[serde(default = "default_patience")]
    pub patience: i64,
    /// Narration (learner's language) when their patience runs out.
    #[serde(default, skip_serializing)]
    pub leaves: String,
    /// What they want from their own day, apart from the player: it colours
    /// every scene they're in. Director-only.
    #[serde(default, skip_serializing)]
    pub motive: String,
    /// Extra sprite art in /characters/<id>/<pose>.png (see POSES).
    #[serde(default)]
    pub poses: Vec<String>,
    /// "standing" (full figure) or "counter" (waist-up art that includes the
    /// counter in front of them, sized to sit in the middle of the scene).
    #[serde(default = "default_stance")]
    pub stance: String,
    /// A side character (the hostel owner, a shopkeeper): pictured and voiced
    /// like the cast, but only appears where a place's situation brings them in.
    #[serde(default)]
    pub minor: bool,
    /// Speaks the player's own language with them (a fellow foreigner) —
    /// except while anyone listed in `own_language_except_near` is on stage.
    #[serde(default)]
    pub speaks_player_language: bool,
    #[serde(default, skip_serializing)]
    pub own_language_except_near: Vec<String>,
    /// A generic passer-by: the face and voice given to an unnamed "extra"
    /// whose speaker_name matches one of its `aliases`.
    #[serde(default)]
    pub townsfolk: bool,
    /// Other names the story or director may give them as an "extra"
    /// speaker_name (e.g. もりさん); those lines become theirs.
    #[serde(default, skip_serializing)]
    pub aliases: Vec<String>,
}

/// Pose art a character may have: expressions, a mouth-open talking frame,
/// and gestures shown while the matching action plays.
pub const POSES: &[&str] = &[
    "happy", "sad", "surprised", "worried", "thinking", "annoyed", "embarrassed", "talk", "point", "bow", "wave",
];

fn default_stance() -> String {
    "standing".into()
}

fn default_locked_story() -> String {
    "Not yet — I should finish what I came here for.".into()
}

fn default_patience() -> i64 {
    8
}

/// Something in the scene that won't wait: a train leaving, a desk closing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneTimer {
    /// Turns until it happens.
    pub turns: u32,
    /// Shown on the HUD, in the learner's language: "The Ueno train leaves".
    pub label: String,
    /// Narration when time runs out.
    #[serde(skip_serializing)]
    pub expires: String,
    /// Where the story moves when it happens ("" = stay).
    #[serde(default, skip_serializing)]
    pub go_to: String,
    #[serde(default, skip_serializing)]
    pub flags: Vec<String>,
}

/// The player's cracked pocket translator. Battery is the budget for help.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub name: String,
    pub name_jp: String,
    pub start_battery: i64,
    pub scan_cost: i64,
    pub hint_cost: i64,
    /// English → Japanese phrase lookup.
    #[serde(default = "default_translate_cost")]
    pub translate_cost: i64,
}

fn default_translate_cost() -> i64 {
    4
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub name_jp: String,
    #[serde(skip_serializing)]
    pub description: String,
    /// Music mood id (`[[audio.music]]`).
    pub music: String,
    /// Ambience loop id (`[[audio.ambience]]`).
    pub ambience: String,
    /// Another time of day of the scene this names (the dorm in the
    /// morning): the director may cut to it within the same place.
    #[serde(default)]
    pub variant_of: String,
    /// The clock shown while this version is on screen ("" = the place's).
    #[serde(default)]
    pub clock: String,
}

/// One generatable audio asset: the prompt is only used server-side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioAsset {
    pub id: String,
    #[serde(skip_serializing)]
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioCatalog {
    pub title_music: String,
    pub epilogue_music: String,
    pub music: Vec<AudioAsset>,
    pub ambience: Vec<AudioAsset>,
    pub sfx: Vec<AudioAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub name_jp: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrammarPoint {
    pub id: String,
    pub pattern: String,
    pub meaning: String,
    pub example_jp: String,
    pub example_romaji: String,
    pub example_en: String,
}

/// What a course teaches, to whom, and where it's set.
///
/// Field naming across all content: `jp`, `name_jp`, `title_jp` hold the
/// TARGET language (what the player is learning); `en`, `name`, `title`
/// hold the LEARNER's own language; `romaji` holds the reading aid. In the
/// Japanese course that's Japanese/English/romaji; in the English course
/// it's English/Japanese/katakana.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Course {
    pub id: String,
    /// BCP-47-ish codes: "ja", "en".
    pub target_lang: String,
    pub learner_lang: String,
    /// Language names in English, for prompts ("Japanese", "English").
    pub target_name: String,
    pub learner_name: String,
    /// What the `romaji` field holds ("Hepburn romaji", "katakana pronunciation").
    pub reading: String,
    /// Course name shown to the learner, in their language.
    pub label: String,
    pub tagline: String,
    /// Money symbol shown on the HUD ("¥", "$").
    pub currency: String,
    /// Player-facing reasons an exit is closed, in the learner's language.
    /// `{lesson}` is replaced with the lesson's index and title.
    pub locked_lesson: String,
    pub locked_unknown: String,
    /// Story flags that only mean "someone told the player where it is":
    /// being told (or saying you're heading there) is enough to set them.
    /// Never tickets, beds or anything else that has to be earned.
    #[serde(default)]
    pub told_flags: Vec<String>,
    /// Why the exits of a story scene stay closed until its goal is done.
    #[serde(default = "default_locked_story")]
    pub locked_story: String,
    /// Narration for walking somewhere ({label}), arriving ({place}) and a
    /// misunderstood line, in the learner's language.
    #[serde(default = "default_set_off", skip_serializing)]
    pub set_off: String,
    #[serde(default = "default_arrive", skip_serializing)]
    pub arrive: String,
    #[serde(default = "default_pause", skip_serializing)]
    pub pause: String,
    #[serde(default = "default_nod", skip_serializing)]
    pub nod: String,
    /// Narration when something costs more than the player has.
    #[serde(default = "default_short_of_money", skip_serializing)]
    pub short_of_money: String,
    /// When a character's patience runs out and they have no line of their own.
    #[serde(default = "default_leaves", skip_serializing)]
    pub leaves: String,
    #[serde(default)]
    pub landing: Landing,
    /// Where the beta demo ends: testers without full access who try to go
    /// here get "thanks for playing" instead. Empty: no demo limit.
    #[serde(default, skip_serializing)]
    pub demo_end: String,
    /// Setting and backstory for the director, in English.
    #[serde(skip_serializing)]
    pub premise: String,
}

fn default_set_off() -> String {
    "You set off: {label}.".into()
}
fn default_arrive() -> String {
    "You arrive at {place}.".into()
}
fn default_leaves() -> String {
    "{name} has to go. A small apologetic bow, and they're gone.".into()
}
fn default_short_of_money() -> String {
    "You count what's in your hand. It isn't enough — not yet.".into()
}
fn default_nod() -> String {
    "They nod — they understood you.".into()
}
fn default_pause() -> String {
    "A pause. They wait for you to try again.".into()
}

/// The title screen for a course, in the learner's language.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Landing {
    pub title: String,
    pub body: String,
    pub scene: String,
    pub place: String,
    pub clock: String,
    /// Cast id of the character shown on the hero.
    pub character: String,
    /// Sample exchanges: the first two float over the hero, the next two
    /// over the first feature, the last is the coach example.
    #[serde(default)]
    pub lines: Vec<Phrase>,
    /// Backdrops for the three feature panels.
    #[serde(default)]
    pub feature_scenes: Vec<String>,
}

/// "I can …": a communicative goal, checked deterministically. It's done
/// when the player says something matching every group of `match_all`
/// (any one form per group) and the listener understood them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanDo {
    pub id: String,
    /// In the learner's language: "I can say what was stolen".
    pub text: String,
    /// A model line in the target language, with its reading.
    pub example: String,
    pub example_reading: String,
    #[serde(skip_serializing)]
    pub match_all: Vec<Vec<String>>,
    /// Look-alike phrases removed from the input before matching, e.g.
    /// いたいです ("it hurts") for a 〜たいです ("want to") goal.
    #[serde(default, skip_serializing)]
    pub ignore: Vec<String>,
}

/// One lesson of the curriculum (Genki I for Japanese, an A1 syllabus for
/// English): the player's own progress track.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lesson {
    pub index: usize,
    pub title: String,
    pub title_jp: String,
    pub topic: String,
    pub min_grammar: usize,
    pub min_turns: u32,
    pub grammar: Vec<GrammarPoint>,
    #[serde(default)]
    pub vocab: Vec<Phrase>,
    /// The lesson completes when these are demonstrated.
    #[serde(default)]
    pub candos: Vec<CanDo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Exit {
    /// Stays open even while the place's story scene is unfinished (it's
    /// right there, like a ticket window along the wall).
    #[serde(default)]
    pub open_in_scene: bool,
    pub to: String,
    pub label: String,
    #[serde(default)]
    pub requires_flags: Vec<String>,
    #[serde(default)]
    pub min_lesson: usize,
}

/// A line a character speaks when an event happens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventLine {
    pub who: String,
    pub jp: String,
    #[serde(default)]
    pub romaji: String,
    pub en: String,
}

/// Something the director may make happen at a place, setting a flag.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceEvent {
    pub flag: String,
    pub when: String,
    /// Short name for the flowchart and the player's log ("Police top-up").
    #[serde(default)]
    pub label: String,
    /// What it costs (a ticket, a bed). The game charges it and refuses the
    /// event if the player can't pay, whatever the director wrote.
    #[serde(default)]
    pub cost: i64,
    /// Money the player receives (a loan, wages).
    #[serde(default)]
    pub gives_yen: i64,
    /// Only tops the player up to this much: they receive the difference,
    /// at most `gives_yen` (a stranger covering the shortfall).
    #[serde(default)]
    pub tops_up_to: i64,
    #[serde(default)]
    pub gives_items: Vec<String>,
    #[serde(default)]
    pub takes_items: Vec<String>,
    /// Other facts that become true with it (a token paid for by someone else is still a ticket).
    #[serde(default)]
    pub sets_flags: Vec<String>,
    #[serde(default)]
    pub requires_flags: Vec<String>,
    #[serde(default)]
    pub requires_items: Vec<String>,
    /// The player must already hold at least this much.
    #[serde(default)]
    pub min_yen: i64,
    /// The player only knows this price once this fact is true (the fare,
    /// once someone tells them): until then nobody assumes they know it.
    #[serde(default)]
    pub price_known_by: String,
    /// What the people here must make clear in the reply where this happens
    /// (why the player needs Tokyo, what the money is for, where to go).
    #[serde(default)]
    pub must_convey: Vec<String>,
    /// Happens as soon as a character says any of these (the fare, "1,270").
    #[serde(default)]
    pub heard: Vec<String>,
    /// Lines the game itself speaks when this happens, so what it means
    /// (the loan, what to do next) is always said, whatever the director wrote.
    #[serde(default)]
    pub says: Vec<EventLine>,
    /// What the player says to make it happen; offered first whenever it can.
    #[serde(default)]
    pub ask: Option<Phrase>,
    /// Can happen again on another visit (a shift, a purchase); otherwise once.
    #[serde(default)]
    pub repeatable: bool,
}

/// A location in the open world.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Place {
    /// Nobody here appears on stage unless they're in the cast: strangers
    /// are voices (sleepers behind bunk curtains).
    #[serde(default)]
    pub unseen_extras: bool,
    pub id: String,
    pub name: String,
    pub name_jp: String,
    /// Words a player might use for this place ("えき", "station"), so
    /// saying where you're going always takes you there.
    #[serde(default, skip_serializing)]
    pub aliases: Vec<String>,
    pub scene: String,
    /// In-world time shown on the HUD.
    pub clock: String,
    /// Story act, for writers organising the file.
    #[serde(skip_serializing)]
    #[allow(dead_code)]
    pub act: u32,
    pub cast: Vec<String>,
    /// Situational context and atmosphere for this place.
    #[serde(skip_serializing)]
    pub situation: String,
    /// The player's own thought about what to do here, in plain English.
    pub goal: String,
    #[serde(skip_serializing)]
    pub success: String,
    #[serde(default, skip_serializing)]
    pub goal_flags: Vec<String>,
    #[serde(default, skip_serializing)]
    pub on_enter_flags: Vec<String>,
    /// Given by the game when the place's goal is done.
    #[serde(default, skip_serializing)]
    pub reward_yen: i64,
    #[serde(default, skip_serializing)]
    pub reward_items: Vec<String>,
    /// Dictionary battery restored when the goal here is achieved.
    #[serde(default, skip_serializing)]
    pub recharge: i64,
    #[serde(default)]
    pub timer: Option<SceneTimer>,
    /// Nobody here is in a hurry (finales, quiet personal scenes): no patience.
    #[serde(default, skip_serializing)]
    pub unhurried: bool,
    #[serde(default, skip_serializing)]
    pub events: Vec<PlaceEvent>,
    #[serde(default)]
    #[serde(skip_serializing)]
    pub exits: Vec<Exit>,
    /// Authored beats for the first visit; later visits are improvised.
    #[serde(default, skip_serializing)]
    pub intro: Vec<Beat>,
    #[serde(default, skip_serializing)]
    pub choices: Vec<Phrase>,
    /// Key words this place teaches; characters seed them before the player needs them.
    #[serde(default)]
    pub pack: Vec<Phrase>,
    /// Can-do ids this place is designed around.
    #[serde(default)]
    pub candos: Vec<String>,
}

/// A step of the big arc, written as the player's own thought.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quest {
    pub id: String,
    pub title: String,
    pub title_jp: String,
    pub flags_any: Vec<String>,
    /// The quest's story graph: the steps toward it, each with the different
    /// ways it can be done. Finishing a step closes its other ways.
    #[serde(default)]
    pub steps: Vec<QuestStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestStep {
    pub id: String,
    pub title: String,
    /// Why this matters, in the player's words ("The fare is ¥1,270; Officer
    /// Sato's loan covers ¥1,000").
    #[serde(default)]
    pub why: String,
    /// Done once any of these facts is true…
    #[serde(default)]
    pub done_any: Vec<String>,
    /// …or the player holds at least this much money.
    #[serde(default)]
    pub done_min_yen: i64,
    pub branches: Vec<Branch>,
}

/// One way to do a step: a story event (or goal fact) at a place.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Branch {
    pub flag: String,
    pub at: String,
    pub label: String,
}

/// The world acting on its own once conditions are met.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trigger {
    pub flag: String,
    #[serde(default)]
    pub requires_flags: Vec<String>,
    #[serde(default)]
    pub min_lesson: usize,
    pub narration: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ending {
    pub flag: String,
    pub title: String,
    pub beats: Vec<Beat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Story {
    pub course: Course,
    pub title: String,
    pub title_jp: String,
    pub start_place: String,
    pub cast: Vec<CastMember>,
    pub items: Vec<Item>,
    pub scenes: Vec<Scene>,
    pub audio: AudioCatalog,
    pub device: Device,
    pub lessons: Vec<Lesson>,
    pub quests: Vec<Quest>,
    #[serde(skip_serializing)]
    pub triggers: Vec<Trigger>,
    pub places: Vec<Place>,
    #[serde(skip_serializing)]
    pub endings: Vec<Ending>,
}

impl Story {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("reading story file {}", path.display()))?;
        let mut story: Story = toml::from_str(&raw).context("parsing story file")?;
        // Lines written as a named "extra" belong to that side character.
        let named: Vec<(String, String)> = story.minor_names();
        let resolve = |b: &mut Beat| {
            if b.speaker == EXTRA
                && let Some((_, id)) = named.iter().find(|(n, _)| *n == b.speaker_name.trim())
            {
                b.speaker = id.clone();
                b.speaker_name.clear();
            }
        };
        let folk = story.clone_townsfolk();
        let face = |b: &mut Beat| {
            if b.speaker == EXTRA
                && let Some(id) = pick_townsfolk(&folk, &b.speaker_name)
            {
                b.speaker = id;
            }
        };
        story.places.iter_mut().filter(|p| !p.unseen_extras).flat_map(|p| p.intro.iter_mut()).for_each(face);
        story.endings.iter_mut().flat_map(|e| e.beats.iter_mut()).for_each(face);
        story.places.iter_mut().flat_map(|p| p.intro.iter_mut()).for_each(resolve);
        story.endings.iter_mut().flat_map(|e| e.beats.iter_mut()).for_each(resolve);
        story.validate()?;
        Ok(story)
    }

    fn validate(&self) -> anyhow::Result<()> {
        let cast: HashSet<&str> = self.cast.iter().map(|c| c.id.as_str()).collect();
        let scenes: HashSet<&str> = self.scenes.iter().map(|s| s.id.as_str()).collect();
        let items: HashSet<&str> = self.items.iter().map(|i| i.id.as_str()).collect();
        let places: HashSet<&str> = self.places.iter().map(|p| p.id.as_str()).collect();

        // Events and the story graph only name things that exist.
        let flags: HashSet<&str> = self.all_flags().into_iter().collect();
        for p in &self.places {
            for e in &p.events {
                for i in e.gives_items.iter().chain(&e.takes_items).chain(&e.requires_items) {
                    if !items.contains(i.as_str()) {
                        bail!("place {}: event {} names unknown item {i}", p.id, e.flag);
                    }
                }
                for f in e.requires_flags.iter().chain(&e.sets_flags) {
                    if !flags.contains(f.as_str()) {
                        bail!("place {}: event {} names unknown flag {f}", p.id, e.flag);
                    }
                }
                for l in &e.says {
                    if !self.cast.iter().any(|c| c.id == l.who) {
                        bail!("place {}: event {} has a line for unknown character {}", p.id, e.flag, l.who);
                    }
                }
            }
        }
        for q in &self.quests {
            for st in &q.steps {
                for f in &st.done_any {
                    if !flags.contains(f.as_str()) {
                        bail!("quest {} step {}: unknown flag {f}", q.id, st.id);
                    }
                }
                for b in &st.branches {
                    let Some(p) = self.place(&b.at) else { bail!("quest {} step {}: unknown place {}", q.id, st.id, b.at) };
                    if !p.events.iter().any(|e| e.flag == b.flag) && !p.goal_flags.contains(&b.flag) && !p.on_enter_flags.contains(&b.flag) {
                        bail!("quest {} step {}: {} can't happen at {}", q.id, st.id, b.flag, b.at);
                    }
                }
            }
        }

        let music: HashSet<&str> = self.audio.music.iter().map(|a| a.id.as_str()).collect();
        let ambience: HashSet<&str> = self.audio.ambience.iter().map(|a| a.id.as_str()).collect();
        for m in [&self.audio.title_music, &self.audio.epilogue_music] {
            if !music.contains(m.as_str()) {
                bail!("audio: unknown music id {m}");
            }
        }
        for sc in &self.scenes {
            if !music.contains(sc.music.as_str()) || !ambience.contains(sc.ambience.as_str()) {
                bail!("scene {}: unknown music or ambience id", sc.id);
            }
        }
        let sfx_names = Sfx::names();
        for a in &self.audio.sfx {
            if !sfx_names.contains(&a.id.as_str()) {
                bail!("audio: sfx {} is not a known Sfx cue", a.id);
            }
        }

        // Curriculum: contiguous lessons with unique grammar ids.
        let mut grammar_ids = HashSet::new();
        for (i, l) in self.lessons.iter().enumerate() {
            if l.index != i {
                bail!("lessons must be listed in order from 0 (found {} at position {i})", l.index);
            }
            if l.grammar.len() < l.min_grammar {
                bail!("lesson {i}: min_grammar exceeds its grammar points");
            }
            for g in &l.grammar {
                if !grammar_ids.insert(g.id.as_str()) {
                    bail!("duplicate grammar id {}", g.id);
                }
            }
        }
        if self.lessons.is_empty() {
            bail!("story has no lessons");
        }
        let mut cando_ids = HashSet::new();
        for c in self.lessons.iter().flat_map(|l| &l.candos) {
            if !cando_ids.insert(c.id.as_str()) {
                bail!("duplicate can-do id {}", c.id);
            }
            if c.match_all.is_empty() || c.match_all.iter().any(|g| g.is_empty()) {
                bail!("can-do {}: match_all needs at least one non-empty group", c.id);
            }
        }

        // Every flag something waits on must be settable somewhere.
        let settable: HashSet<&str> = self.all_flags().into_iter().collect();
        let need = |f: &str, ctx: &str| -> anyhow::Result<()> {
            if !settable.contains(f) {
                bail!("{ctx}: flag {f} is never set by any place, event or trigger");
            }
            Ok(())
        };

        for c in &self.cast {
            if !["standing", "counter"].contains(&c.stance.as_str()) {
                bail!("cast {}: stance must be standing or counter", c.id);
            }
            if let Some(bad) = c.poses.iter().find(|p| !POSES.contains(&p.as_str())) {
                bail!("cast {}: unknown pose {bad} (known: {})", c.id, POSES.join(", "));
            }
        }
        for p in &self.places {
            if let Some(t) = &p.timer {
                if t.turns == 0 {
                    bail!("place {}: timer needs at least one turn", p.id);
                }
                if !t.go_to.is_empty() && !places.contains(t.go_to.as_str()) {
                    bail!("place {}: timer goes to unknown place {}", p.id, t.go_to);
                }
            }
        }
        if !self.course.demo_end.is_empty() && !places.contains(self.course.demo_end.as_str()) {
            bail!("course demo_end {} is not a place", self.course.demo_end);
        }
        if !places.contains(self.start_place.as_str()) {
            bail!("start_place {} is not a place", self.start_place);
        }
        let land = &self.course.landing;
        if !land.title.is_empty() {
            if !cast.contains(land.character.as_str()) {
                bail!("course landing: unknown cast member {}", land.character);
            }
            if let Some(sc) = std::iter::once(&land.scene).chain(&land.feature_scenes).find(|s| !scenes.contains(s.as_str())) {
                bail!("course landing: unknown scene {sc}");
            }
        }
        for p in &self.places {
            let ctx = |what: &str| format!("place {}: {what}", p.id);
            if !scenes.contains(p.scene.as_str()) {
                bail!(ctx(&format!("unknown scene {}", p.scene)));
            }
            for c in &p.cast {
                if !cast.contains(c.as_str()) {
                    bail!(ctx(&format!("unknown cast member {c}")));
                }
            }
            for i in &p.reward_items {
                if !items.contains(i.as_str()) {
                    bail!(ctx(&format!("unknown item {i}")));
                }
            }
            for e in &p.exits {
                if !places.contains(e.to.as_str()) {
                    bail!(ctx(&format!("exit to unknown place {}", e.to)));
                }
                if e.min_lesson >= self.lessons.len() {
                    bail!(ctx(&format!("exit to {} needs a lesson that doesn't exist", e.to)));
                }
                for f in &e.requires_flags {
                    need(f, &ctx(&format!("exit to {}", e.to)))?;
                }
            }
            for b in &p.intro {
                self.validate_beat(b, &cast, &scenes).map_err(|e| anyhow::anyhow!(ctx(&e)))?;
            }
            for c in &p.candos {
                if !cando_ids.contains(c.as_str()) {
                    bail!(ctx(&format!("unknown can-do {c}")));
                }
            }
        }
        for q in &self.quests {
            for f in &q.flags_any {
                need(f, &format!("quest {}", q.id))?;
            }
        }
        for t in &self.triggers {
            for f in &t.requires_flags {
                need(f, &format!("trigger {}", t.flag))?;
            }
        }
        for e in &self.endings {
            need(&e.flag, &format!("ending {}", e.title))?;
            for b in &e.beats {
                self.validate_beat(b, &cast, &scenes).map_err(|err| anyhow::anyhow!("ending {}: {err}", e.title))?;
            }
        }
        Ok(())
    }

    fn validate_beat(
        &self,
        b: &Beat,
        cast: &HashSet<&str>,
        scenes: &HashSet<&str>,
    ) -> Result<(), String> {
        if !is_inner(&b.speaker) && b.speaker != EXTRA && !cast.contains(b.speaker.as_str()) {
            return Err(format!("unknown speaker {}", b.speaker));
        }
        if let Some(who) = b.enter.iter().find(|w| !cast.contains(w.as_str())) {
            return Err(format!("unknown character {who} entering"));
        }
        if !b.scene.is_empty() && !scenes.contains(b.scene.as_str()) {
            return Err(format!("unknown scene {}", b.scene));
        }
        Ok(())
    }

    /// Every name a side character answers to (as an "extra" speaker_name), with their id.
    pub fn minor_names(&self) -> Vec<(String, String)> {
        self.cast
            .iter()
            .filter(|c| c.minor)
            .flat_map(|c| [c.name_jp.clone(), c.name.clone()].into_iter().chain(c.aliases.iter().cloned()).map(move |n| (n.trim().to_string(), c.id.clone())))
            .filter(|(n, _)| !n.is_empty())
            .collect()
    }

    fn clone_townsfolk(&self) -> Vec<(String, Vec<String>)> {
        self.cast.iter().filter(|c| c.townsfolk).map(|c| (c.id.clone(), c.aliases.clone())).collect()
    }

    /// The passer-by who plays an unnamed speaker, if they should be seen.
    pub fn townsfolk_for(&self, speaker_name: &str) -> Option<String> {
        pick_townsfolk(&self.clone_townsfolk(), speaker_name)
    }

    /// Any passer-by, picked steadily from `seed` (the line itself), for a
    /// stranger the director didn't name.
    pub fn any_townsfolk(&self, seed: &str) -> Option<String> {
        let folk = self.clone_townsfolk();
        if folk.is_empty() {
            return None;
        }
        let hash = seed.bytes().fold(0usize, |h, b| h.wrapping_mul(31).wrapping_add(b as usize));
        Some(folk[hash % folk.len()].0.clone())
    }

    /// The versions of a place's scene at other times of day.
    pub fn scene_versions(&self, scene: &str) -> Vec<&Scene> {
        self.scenes.iter().filter(|s| s.variant_of == scene).collect()
    }

    /// The side character an "extra" speaker_name refers to, if any.
    pub fn minor_by_name(&self, name: &str) -> Option<&CastMember> {
        let name = name.trim();
        self.cast.iter().find(|c| c.minor && (c.name_jp == name || c.name == name || c.aliases.iter().any(|a| a == name)))
    }

    pub fn cast_member(&self, id: &str) -> Option<&CastMember> {
        self.cast.iter().find(|c| c.id == id)
    }

    pub fn place(&self, id: &str) -> Option<&Place> {
        self.places.iter().find(|p| p.id == id)
    }

    pub fn cando(&self, id: &str) -> Option<&CanDo> {
        self.lessons.iter().flat_map(|l| &l.candos).find(|c| c.id == id)
    }

    pub fn all_grammar_ids(&self) -> Vec<&str> {
        self.lessons.iter().flat_map(|l| l.grammar.iter().map(|g| g.id.as_str())).collect()
    }

    /// Every flag the world can set, sorted and de-duplicated.
    pub fn all_flags(&self) -> Vec<&str> {
        let mut v: Vec<&str> = self
            .places
            .iter()
            .flat_map(|p| {
                p.goal_flags
                    .iter()
                    .chain(&p.on_enter_flags)
                    .map(String::as_str)
                    .chain(p.events.iter().flat_map(|e| std::iter::once(e.flag.as_str()).chain(e.sets_flags.iter().map(String::as_str))))
                    .chain(p.timer.iter().flat_map(|t| t.flags.iter().map(String::as_str)))
            })
            .chain(self.triggers.iter().map(|t| t.flag.as_str()))
            .collect();
        v.sort_unstable();
        v.dedup();
        v
    }
}

/// Voices that come from nowhere: an announcement, a radio, a cry in the dark.
const UNSEEN: &[&str] = &["???", "アナウンス", "announce", "放送", "voice", "声", "radio", "ラジオ", "テレビ", "tv", "speaker", "crowd", "群衆", "みんな", "everyone"];

/// Matches an unnamed speaker to a townsfolk figure by the first alias found
/// in their name (townsfolk are listed most specific first); anyone else gets
/// a stable pick from the name, so the same stranger keeps the same face.
fn pick_townsfolk(folk: &[(String, Vec<String>)], speaker_name: &str) -> Option<String> {
    let name = speaker_name.trim().to_lowercase();
    if folk.is_empty() || name.is_empty() || UNSEEN.iter().any(|u| name.contains(&u.to_lowercase())) {
        return None;
    }
    if let Some((id, _)) = folk.iter().find(|(_, aliases)| aliases.iter().any(|a| name.contains(&a.to_lowercase()))) {
        return Some(id.clone());
    }
    let hash = name.bytes().fold(0usize, |h, b| h.wrapping_mul(31).wrapping_add(b as usize));
    Some(folk[hash % folk.len()].0.clone())
}

#[cfg(test)]
mod tests {
    use super::Story;

    /// Every course folder must hold a story that passes validation.
    #[test]
    fn every_course_story_loads() {
        let mut n = 0;
        for entry in std::fs::read_dir("content/courses").unwrap() {
            let path = entry.unwrap().path().join("story.toml");
            if path.exists() {
                let story = Story::load(&path).unwrap_or_else(|e| panic!("{}: {e:#}", path.display()));
                assert_eq!(path.parent().unwrap().file_name().unwrap().to_str().unwrap(), story.course.id);
                n += 1;
            }
        }
        assert!(n >= 1);
    }
}
