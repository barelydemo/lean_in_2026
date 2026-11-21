"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type {
  CanDo,
  CastMember,
  DiaryEntry,
  DiaryLineFeedback,
  GrammarPoint,
  Line,
  Place,
  Run,
  SkillBranch,
  SkillBranchId,
  SkillNode,
  Story,
  UnlockedSkill,
} from "@/lib/types";
import { NARRATOR, OWN_AFTER, PLAYER } from "@/lib/types";
import { RANK_STYLES, type Rank } from "./Cards";

export type HubTab = "people" | "places" | "progress" | "diary" | "log";

export const SKILL_BRANCHES: SkillBranch[] = [
  {
    id: "social",
    icon: "🤝",
    title: "Social & Connection",
    title_jp: "交流・人間関係",
    subtitle: "Greetings, introductions, small talk, and casual friendships",
    accent: "#10b981",
    nodes: [
      {
        id: "social_greetings",
        branch: "social",
        icon: "🌿",
        title: "Greetings & Well-being",
        title_jp: "あいさつ",
        formula: "大丈夫です ／ すみません ／ ありがとうございます",
        unlockHint: "Say だいじょうぶです, すみません, or ありがとうございます",
        unlockHintJp: "「だいじょうぶです」「すみません」「ありがとうございます」",
        explanation:
          "Essential survival expressions in Japan: reassure someone you are okay, get attention or apologize with すみません, or thank someone politely.",
        grammarIds: ["g0_daijoubu", "g0_sumimasen", "g0_hai_iie", "g0_wakarimasen", "g0_arigatou"],
        candoIds: ["l0_okay", "l0_sorry", "l0_thanks", "l0_dont_understand"],
        examples: [
          {
            jp: "はい、大丈夫です。ありがとうございます。",
            romaji: "Hai, daijoubu desu. Arigatou gozaimasu.",
            en: "Yes, I'm okay. Thank you very much.",
            speakerId: "kenji",
            speakerName: "Kenji",
          },
          {
            jp: "すみません、もういちどおねがいします。",
            romaji: "Sumimasen, mou ichido onegaishimasu.",
            en: "Excuse me, one more time please.",
            speakerId: "aiko",
            speakerName: "Aiko",
          },
        ],
      },
      {
        id: "social_intro",
        branch: "social",
        icon: "🪪",
        title: "Introductions & Identity",
        title_jp: "自己紹介",
        formula: "[Topic X] は [Identity Y] です（〜か ／ 〜の）",
        unlockHint: "Introduce yourself with わたしは〜です or 〜じんです",
        unlockHintJp: "「わたしは〜です」「アメリカじんです」",
        explanation:
          "The backbone X は Y です sentence structure lets you state your name, nationality (〜じん), occupation, and ask polite questions by adding か.",
        grammarIds: ["g1_x_wa_y_desu", "g1_ka_question", "g1_no_modifier", "g1_nationality"],
        candoIds: ["l1_name", "l1_from", "l1_ask"],
        examples: [
          {
            jp: "わたしはがくせいです。よろしくおねがいします。",
            romaji: "Watashi wa gakusei desu. Yoroshiku onegaishimasu.",
            en: "I am a student. Nice to meet you.",
            speakerId: "aiko",
            speakerName: "Aiko",
          },
          {
            jp: "おなまえはなんですか。",
            romaji: "Onamae wa nan desu ka.",
            en: "What is your name?",
            speakerId: "yumi",
            speakerName: "Officer Sato",
          },
        ],
      },
      {
        id: "social_likes",
        branch: "social",
        icon: "💬",
        title: "Small Talk & Likes",
        title_jp: "すきです",
        formula: "[Noun / Verb+の] が すきです ／ いっしょに〜ましょう",
        unlockHint: "Share what you like (〜がすきです) or invite someone (〜ましょう)",
        unlockHintJp: "「〜がすきです」「いっしょに〜ましょう」",
        explanation:
          "Build rapport with Tokyo locals by describing places with い／な adjectives, sharing your favorite foods or hobbies with がすきです, and suggesting activities together with 〜ましょう.",
        grammarIds: ["g5_adjectives", "g5_suki", "g5_mashou", "g8_no_ga_suki"],
        candoIds: ["c5_describe", "c5_like", "c5_lets", "c5_ask_opinion", "c8_like_doing"],
        examples: [
          {
            jp: "にほんのたべものがすきです。いっしょにたべましょう！",
            romaji: "Nihon no tabemono ga suki desu. Issho ni tabemashou!",
            en: "I like Japanese food. Let's eat together!",
            speakerId: "aiko",
            speakerName: "Aiko",
          },
          {
            jp: "このまちはにぎやかでたのしいですね。",
            romaji: "Kono machi wa nigiyaka de tanoshii desu ne.",
            en: "This town is lively and fun, isn't it.",
            speakerId: "emily",
            speakerName: "Emily",
          },
        ],
      },
      {
        id: "social_casual",
        branch: "social",
        icon: "🍻",
        title: "Casual Plain Form",
        title_jp: "タメ口",
        formula: "[Plain Form] + と思います ／ 〜と言っていました ／ 〜から",
        unlockHint: "Express an opinion with 〜と思います or give a reason with 〜から",
        unlockHintJp: "「〜とおもいます」「〜だから」",
        explanation:
          "Unlock natural casual speech (short forms) to express thoughts (〜と思います), relay what others told you (〜と言っていました), and connect reasons with 〜から.",
        grammarIds: ["g8_short_present", "g8_to_omoimasu", "g8_to_itte_imashita", "g9_short_past", "g9_kara_reason"],
        candoIds: ["c8_think", "c8_said", "c9_past_opinion", "c9_because"],
        examples: [
          {
            jp: "たこやきがいちばんおいしいと思います。",
            romaji: "Takoyaki ga ichiban oishii to omoimasu.",
            en: "I think takoyaki is the most delicious.",
            speakerId: "aiko",
            speakerName: "Aiko",
          },
          {
            jp: "つかれたから、そろそろかえります。",
            romaji: "Tsukareta kara, sorosoro kaerimasu.",
            en: "Because I'm tired, I'll head back soon.",
            speakerId: "hiroshi",
            speakerName: "Hiroshi",
          },
        ],
      },
    ],
  },
  {
    id: "survival",
    icon: "🧭",
    title: "Survival & Navigation",
    title_jp: "サバイバル・移動",
    subtitle: "Reporting lost items, finding landmarks, and riding Tokyo transit",
    accent: "#0ea5e9",
    nodes: [
      {
        id: "survival_existence",
        branch: "survival",
        icon: "🔍",
        title: "Existence & Missing Items",
        title_jp: "あります/います",
        formula: "[Item] が あります ／ ありません（ぬすまれました）",
        unlockHint: "Say かばんがありません or ask 〜はありますか",
        unlockHintJp: "「パスポートがありません」「でんわはありますか」",
        explanation:
          "Use あります (inanimate objects) and います (people/animals) to ask whether a payphone or item exists, or report that your bag and passport are missing (ありません).",
        grammarIds: ["g4_arimasu_imasu"],
        candoIds: ["l2_lost", "l4_is_there"],
        examples: [
          {
            jp: "すみません、かばんとパスポートがありません！",
            romaji: "Sumimasen, kaban to pasupooto ga arimasen!",
            en: "Excuse me, my bag and passport are gone!",
            speakerId: "yumi",
            speakerName: "Officer Sato",
          },
          {
            jp: "このちかくに公衆電話はありますか。",
            romaji: "Kono chikaku ni koushuu denwa wa arimasu ka.",
            en: "Is there a payphone near here?",
            speakerId: "hiroshi",
            speakerName: "Hiroshi",
          },
        ],
      },
      {
        id: "survival_locations",
        branch: "survival",
        icon: "📍",
        title: "Locations & Spatial Words",
        title_jp: "うえ/した/となり",
        formula: "[Landmark] は どこですか ／ [X] の [うえ・した・となり・なか]",
        unlockHint: "Ask where something is with どこですか or use となり/なか/うえ",
        unlockHintJp: "「えきはどこですか」「レジのとなりです」",
        explanation:
          "Pinpoint exact positions in convenience stores, stations, and streets using どこ (where) and spatial nouns like となり (next to), うえ (on), した (under), and なか (inside).",
        grammarIds: ["g2_doko", "g4_location_words"],
        candoIds: ["l2_where", "l4_location"],
        examples: [
          {
            jp: "すみません、こうばんはどこですか。",
            romaji: "Sumimasen, kouban wa doko desu ka.",
            en: "Excuse me, where is the police box?",
            speakerId: "kenji",
            speakerName: "Kenji",
          },
          {
            jp: "おにぎりはレジのとなりにありますよ。",
            romaji: "Onigiri wa reji no tonari ni arimasu yo.",
            en: "The rice balls are right next to the register.",
            speakerId: "aiko",
            speakerName: "Aiko",
          },
        ],
      },
      {
        id: "survival_transit",
        branch: "survival",
        icon: "🚆",
        title: "Directions & Transit",
        title_jp: "駅に行きます",
        formula: "[Transport] で [Destination] に／へ いきます",
        unlockHint: "State your destination with 〜に行きます or 〜へ行きます",
        unlockHintJp: "「駅に行きます」「でんしゃでうえのへいきます」",
        explanation:
          "Navigate Tokyo's rail network by marking your destination with に or へ and your mode of travel with で before motion verbs like いきます (go) and かえります (return).",
        grammarIds: ["g3_ni_e_destination", "g3_de_means_place"],
        candoIds: ["l3_going"],
        examples: [
          {
            jp: "でんしゃでうえのへいきます。",
            romaji: "Densha de Ueno e ikimasu.",
            en: "I'm going to Ueno by train.",
            speakerId: "hiroshi",
            speakerName: "Hiroshi",
          },
          {
            jp: "これから浅草のホステルに行きます。",
            romaji: "Kore kara Asakusa no hosuteru ni ikimasu.",
            en: "I'm heading to the hostel in Asakusa now.",
            speakerId: "emily",
            speakerName: "Emily",
          },
        ],
      },
    ],
  },
  {
    id: "commerce",
    icon: "🛒",
    title: "Commerce & Dining",
    title_jp: "買い物・注文",
    subtitle: "Pointing out items, checking prices, and making polite requests",
    accent: "#f59e0b",
    nodes: [
      {
        id: "commerce_demo",
        branch: "commerce",
        icon: "👉",
        title: "Demonstratives & Items",
        title_jp: "これ/それ/あれ",
        formula: "これ／それ／あれ は [Owner] の（じゃありません）",
        unlockHint: "Identify items using これ/それ/あれ or 〜じゃありません",
        unlockHintJp: "「これはわたしのじゃありません」",
        explanation:
          "Distinguish items near you (これ), near the listener (それ), or over there (あれ), claim ownership with の, and clarify mistakes with じゃありません.",
        grammarIds: ["g2_kore_sore_are", "g2_dare_no", "g2_ja_arimasen", "g2_mo"],
        candoIds: ["l2_not_mine"],
        examples: [
          {
            jp: "それはわたしのかばんじゃありません。",
            romaji: "Sore wa watashi no kaban ja arimasen.",
            en: "That is not my bag.",
            speakerId: "yumi",
            speakerName: "Officer Sato",
          },
          {
            jp: "これはだれのかさですか。",
            romaji: "Kore wa dare no kasa desu ka.",
            en: "Whose umbrella is this?",
            speakerId: "aiko",
            speakerName: "Aiko",
          },
        ],
      },
      {
        id: "commerce_prices",
        branch: "commerce",
        icon: "💴",
        title: "Prices & Comparisons",
        title_jp: "いくら",
        formula: "[Item] は いくらですか ／ [A] は [B] より〜（いちばん）",
        unlockHint: "Ask a price with いくらですか or compare with より / いちばん",
        unlockHintJp: "「うえのまで、いくらですか」",
        explanation:
          "Count your yen carefully! Ask fares and prices with いくらですか, compare options with AはBより〜, and pick the best choice with いちばん.",
        grammarIds: ["g3_ikura", "g10_yori", "g10_ichiban"],
        candoIds: ["l3_price", "c10_compare", "c10_most"],
        examples: [
          {
            jp: "すみません、うえのまでいくらですか。",
            romaji: "Sumimasen, Ueno made ikura desu ka.",
            en: "Excuse me, how much is it to Ueno?",
            speakerId: "hiroshi",
            speakerName: "Hiroshi",
          },
          {
            jp: "おにぎりはサンドイッチよりやすいです。",
            romaji: "Onigiri wa sandoitchi yori yasui desu.",
            en: "Rice balls are cheaper than sandwiches.",
            speakerId: "aiko",
            speakerName: "Aiko",
          },
        ],
      },
      {
        id: "commerce_requests",
        branch: "commerce",
        icon: "🍱",
        title: "Ordering & Requests",
        title_jp: "〜をください / 〜てください",
        formula: "[Item] をください ／ [Verb て-form] ください ／ 〜てもいいですか",
        unlockHint: "Order or ask politely with 〜をください or 〜てください",
        unlockHintJp: "「きっぷをください」「ゆっくりはなしてください」",
        explanation:
          "Order food and tickets with [Noun] をください, ask someone for help with [Verb て-form] ください, or ask permission with 〜てもいいですか.",
        grammarIds: ["g3_o_object", "g6_te_kudasai", "g6_te_mo_ii", "g6_te_wa_ikemasen", "g8_naide_kudasai"],
        candoIds: ["l3_request", "c6_please_do", "c6_may_i", "c6_rule", "c8_dont"],
        examples: [
          {
            jp: "しゃけおにぎりをひとつください。",
            romaji: "Shake onigiri o hitotsu kudasai.",
            en: "One salmon onigiri, please.",
            speakerId: "aiko",
            speakerName: "Aiko",
          },
          {
            jp: "すみません、ゆっくりはなしてください。",
            romaji: "Sumimasen, yukkuri hanashite kudasai.",
            en: "Excuse me, please speak slowly.",
            speakerId: "kenji",
            speakerName: "Kenji",
          },
        ],
      },
    ],
  },
  {
    id: "daily",
    icon: "⏱️",
    title: "Daily Life & Desires",
    title_jp: "日常・願望・予定",
    subtitle: "Describing actions across time, expressing desires, and future plans",
    accent: "#8b5cf6",
    nodes: [
      {
        id: "daily_routine",
        branch: "daily",
        icon: "🕰️",
        title: "Time & Daily Routine",
        title_jp: "時/日/〜ます",
        formula: "〜ます ／ 〜ました ／ 〜ています（〜てから）",
        unlockHint: "Describe past events (〜ました) or ongoing states (〜ています)",
        unlockHintJp: "「けさ、にほんにきました」「あかいジャケットをきています」",
        explanation:
          "Narrate what happened earlier with 〜ました, sequence actions with 〜てから, and describe what someone is wearing or doing right now with 〜ています.",
        grammarIds: [
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
        candoIds: ["l4_past", "c6_then", "c7_wearing", "c7_looks", "c7_doing", "c7_family", "c9_not_yet", "c9_verb_noun"],
        examples: [
          {
            jp: "けさ、にほんにきました。",
            romaji: "Kesa, Nihon ni kimashita.",
            en: "I arrived in Japan this morning.",
            speakerId: "yumi",
            speakerName: "Officer Sato",
          },
          {
            jp: "そのひとはあかいジャケットをきています。",
            romaji: "Sono hito wa akai jaketto o kite imasu.",
            en: "That person is wearing a red jacket.",
            speakerId: "kenji",
            speakerName: "Kenji",
          },
        ],
      },
      {
        id: "daily_desires",
        branch: "daily",
        icon: "✨",
        title: "Desires & Experiences",
        title_jp: "〜たいです",
        formula: "[Verb stem] + たいです ／ 〜たことがあります ／ 〜たり〜たり",
        unlockHint: "Say what you want to do with 〜たいです or 〜たことがあります",
        unlockHintJp: "「うちにかえりたいです」「みたことがあります」",
        explanation:
          "Turn any verb stem into a personal wish with 〜たいです (I want to ~), talk about life experiences with 〜たことがあります, and list activities with 〜たり〜たりします.",
        grammarIds: ["g11_tai", "g11_tari", "g11_koto_ga_aru", "g11_ya"],
        candoIds: ["c11_want", "c11_tari", "c11_ever"],
        examples: [
          {
            jp: "はやくパスポートをみつけたいです。",
            romaji: "Hayaku pasupooto o mitsuketai desu.",
            en: "I want to find my passport soon.",
            speakerId: "emily",
            speakerName: "Emily",
          },
          {
            jp: "まえに、にほんにきたことがあります。",
            romaji: "Mae ni, Nihon ni kita koto ga arimasu.",
            en: "I have been to Japan before.",
            speakerId: "hiroshi",
            speakerName: "Hiroshi",
          },
        ],
      },
      {
        id: "daily_plans",
        branch: "daily",
        icon: "🎯",
        title: "Plans & Intentions",
        title_jp: "〜つもりです",
        formula: "[Verb plain] + つもりです ／ 〜んです ／ 〜たほうがいいです",
        unlockHint: "State your intention with 〜つもりです or explain with 〜んです",
        unlockHintJp: "「にほんにいるつもりです」「あたまがいたいんです」",
        explanation:
          "Express firm intentions with 〜つもりです, explain the background of your predicament with 〜んです, and give or ask for advice with 〜たほうがいいです.",
        grammarIds: ["g10_tsumori", "g10_naru", "g12_n_desu", "g12_sugiru", "g12_hou_ga_ii", "g12_node", "g12_nakereba"],
        candoIds: ["c10_plan", "c10_become", "c12_explain", "c12_too_much", "c12_advice", "c12_probably"],
        examples: [
          {
            jp: "らいねんもにほんにいるつもりです。",
            romaji: "Rainen mo Nihon ni iru tsumori desu.",
            en: "I plan to stay in Japan next year too.",
            speakerId: "emily",
            speakerName: "Emily",
          },
          {
            jp: "くうこうでころんだんです。すこしやすんだほうがいいですか。",
            romaji: "Kuukou de koronda n desu. Sukoshi yasunda hou ga ii desu ka.",
            en: "I fell at the airport. Should I rest a bit?",
            speakerId: "aiko",
            speakerName: "Aiko",
          },
        ],
      },
    ],
  },
];

const TABS: { id: HubTab; icon: string; label: string; labelJp: string }[] = [
  { id: "people", icon: "👥", label: "People", labelJp: "登場人物" },
  { id: "places", icon: "🗺️", label: "Places", labelJp: "場所" },
  { id: "progress", icon: "📈", label: "Progress", labelJp: "進捗" },
  { id: "diary", icon: "📖", label: "Diary", labelJp: "旅日記" },
  { id: "log", icon: "💬", label: "Spoken Log", labelJp: "会話履歴" },
];

const VERDICT_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  great: { label: "Great!", bg: "bg-emerald-100", text: "text-emerald-800" },
  good: { label: "Good", bg: "bg-teal-100", text: "text-teal-800" },
  understood: { label: "Understood", bg: "bg-sky-100", text: "text-sky-800" },
  not_understood: { label: "Not quite", bg: "bg-amber-100", text: "text-amber-800" },
  english: { label: "English used", bg: "bg-rose-100", text: "text-rose-800" },
  none: { label: "Spoken", bg: "bg-zinc-100", text: "text-zinc-700" },
};

function normalizeLine(raw: [number, Omit<Line, "id">] | Line): Line {
  if (Array.isArray(raw)) {
    const [id, beat] = raw;
    return { id, ...beat };
  }
  return raw;
}

function formatDate(ts: number): string {
  if (!ts) return "Recently";
  try {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function trustLabel(trust: number): { label: string; color: string } {
  if (trust >= 5) return { label: "Trusted Ally", color: "text-emerald-700 bg-emerald-100" };
  if (trust >= 2) return { label: "Friendly", color: "text-teal-700 bg-teal-100" };
  if (trust >= 1) return { label: "Warming Up", color: "text-sky-700 bg-sky-100" };
  if (trust < 0) return { label: "Wary", color: "text-rose-700 bg-rose-100" };
  return { label: "Acquaintance", color: "text-zinc-700 bg-zinc-100" };
}

export function CompanionHub({
  open,
  initialTab = "people",
  initialSkillNodeId = null,
  mode = "ingame",
  story,
  run,
  entries,
  backlog,
  cast,
  grammar,
  onClose,
  onEnterScene,
  onNextScene,
  onTravel,
  onReplayLine,
  onPreviewVoice,
}: {
  open: boolean;
  initialTab?: HubTab;
  initialSkillNodeId?: string | null;
  /** "resume" when opened from Homepage Continue; "scorecard" at scene end; "ingame" during play */
  mode?: "resume" | "scorecard" | "ingame";
  story: Story;
  run: Run;
  entries: DiaryEntry[];
  backlog: Line[];
  cast: Record<string, CastMember>;
  grammar: Record<string, GrammarPoint>;
  onClose: () => void;
  /** Called when clicking "Enter Scene / Start Speaking" from homepage Continue */
  onEnterScene?: () => void;
  /** Called when clicking "Next Scene →" at the end of a completed scene */
  onNextScene?: () => void;
  /** Called when traveling directly to an open exit from the Places tab */
  onTravel?: (to: string) => void;
  /** Replays character voice audio for a line */
  onReplayLine?: (line: Line) => void;
  /** Plays TTS preview for example shadowing sentences */
  onPreviewVoice?: (text: string, speakerId?: string) => void;
}) {
  const [tab, setTab] = useState<HubTab>(initialTab);
  const [selectedDiaryId, setSelectedDiaryId] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<SkillBranchId | "all">("all");
  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(initialSkillNodeId);
  const [playingSampleJp, setPlayingSampleJp] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      if (initialSkillNodeId) {
        setInspectedNodeId(initialSkillNodeId);
      }
    }
  }, [open, initialTab, initialSkillNodeId]);

  useEffect(() => {
    if (open && entries.length > 0) {
      setSelectedDiaryId(entries[entries.length - 1].id);
    }
  }, [open, entries]);

  const s = run.state;
  const currentPlace: Place =
    story.places.find((p) => p.id === s.place) ?? story.places[0];

  useEffect(() => {
    if (open && !selectedPlaceId) {
      setSelectedPlaceId(currentPlace.id);
    }
  }, [open, currentPlace.id, selectedPlaceId]);

  const visitedSet = useMemo(() => {
    const v = new Set<string>(s.visited ?? []);
    v.add(s.place);
    for (const d of entries) v.add(d.place_id);
    for (const g of s.goals_done ?? []) v.add(g);
    return v;
  }, [s.visited, s.place, s.goals_done, entries]);

  const metCastSet = useMemo(() => {
    const m = new Set<string>();
    for (const pid of visitedSet) {
      const pl = story.places.find((p) => p.id === pid);
      pl?.cast.forEach((cid) => m.add(cid));
    }
    Object.keys(s.trust ?? {}).forEach((cid) => m.add(cid));
    for (const l of backlog) {
      if (l.speaker in cast) m.add(l.speaker);
    }
    return m;
  }, [visitedSet, story.places, s.trust, backlog, cast]);

  const activeDiary =
    entries.find((e) => e.id === selectedDiaryId) ??
    entries[entries.length - 1] ??
    null;

  // Combine all dialogue lines (past diary entries + current backlog/run lines) for Spoken Log
  const allSpokenLines = useMemo(() => {
    const seenIds = new Set<number>();
    const combined: {
      line: Line;
      placeName: string;
      feedback?: DiaryLineFeedback;
      pronScore?: number;
    }[] = [];

    for (const entry of entries) {
      const pronMetric = entry.metrics?.["Pronunciation (Levenshtein)"];
      for (const raw of entry.lines ?? []) {
        const l = normalizeLine(raw);
        if (l.id > 0 && seenIds.has(l.id)) continue;
        if (l.id > 0) seenIds.add(l.id);
        const fb =
          l.speaker === PLAYER
            ? entry.feedbacks?.find((f) => f.line_id === l.id)
            : undefined;
        combined.push({
          line: l,
          placeName: entry.place_name,
          feedback: fb,
          pronScore: l.speaker === PLAYER ? pronMetric : undefined,
        });
      }
    }

    const activeLines = backlog.length > 0 ? backlog : run.lines;
    for (const l of activeLines) {
      if (l.id > 0 && seenIds.has(l.id)) continue;
      if (l.id > 0) seenIds.add(l.id);
      combined.push({
        line: l,
        placeName: currentPlace.name,
      });
    }

    return combined;
  }, [entries, backlog, run.lines, currentPlace.name]);

  const currentQuest = story.quests.find((q) => q.id === s.quest);
  const candosDone = useMemo(() => new Set(s.candos_done ?? []), [s.candos_done]);
  const wordsList = Object.entries(s.known_words ?? {}).filter(
    ([, w]) => w.kind !== "particle",
  );
  const wordsMasteredCount = wordsList.filter(([, w]) => w.mastered).length;

  const allCanDosMap = useMemo(() => {
    const m: Record<string, CanDo & { lessonIndex: number }> = {};
    for (const l of story.lessons) {
      for (const c of l.candos) {
        m[c.id] = { ...c, lessonIndex: l.index };
      }
    }
    return m;
  }, [story.lessons]);

  const allSkillNodes = useMemo(
    () => SKILL_BRANCHES.flatMap((b) => b.nodes),
    [],
  );

  // Merge server unlocked_skills with fallback inference from candos_done / grammar_counts / spoken log
  const resolvedSkills = useMemo(() => {
    const map: Record<string, UnlockedSkill> = { ...(s.unlocked_skills ?? {}) };
    const playerSpoken = allSpokenLines.filter((item) => item.line.speaker === PLAYER && item.line.jp);

    for (const node of allSkillNodes) {
      if (map[node.id]) continue;
      const candoHits = node.candoIds.filter((cid) => candosDone.has(cid));
      const grammarHits = node.grammarIds.reduce(
        (acc, gid) => acc + (s.grammar_counts?.[gid] ?? 0),
        0,
      );
      if (candoHits.length === 0 && grammarHits === 0) continue;

      // Find a matching spoken line from the player's log if available
      const matchedSpoken =
        playerSpoken.find((item) =>
          item.feedback?.grammar_used?.some((gid) => node.grammarIds.includes(gid)),
        ) ?? playerSpoken[playerSpoken.length - 1];

      const totalUses = Math.max(1, grammarHits, candoHits.length);
      const level = totalUses >= 3 ? 3 : totalUses >= 2 ? 2 : 1;
      const firstCando = candoHits[0] ? allCanDosMap[candoHits[0]] : undefined;

      map[node.id] = {
        node_id: node.id,
        branch: node.branch,
        title: node.title,
        title_jp: node.title_jp,
        icon: node.icon,
        sentence: matchedSpoken?.line.jp ?? firstCando?.example ?? node.examples[0]?.jp ?? "",
        pron_score: matchedSpoken?.pronScore ?? null,
        verdict: matchedSpoken?.feedback?.verdict ?? "good",
        place_id: s.place,
        place_name: matchedSpoken?.placeName ?? currentPlace.name,
        timestamp: 0,
        mastery_level: level,
        uses: totalUses,
      };
    }
    return map;
  }, [s.unlocked_skills, s.grammar_counts, s.place, candosDone, allSkillNodes, allSpokenLines, allCanDosMap, currentPlace.name]);

  const unlockedSkillCount = Object.keys(resolvedSkills).length;
  const totalMasteryStars = Object.values(resolvedSkills).reduce(
    (sum, sk) => sum + Math.min(3, Math.max(1, sk.mastery_level || 1)),
    0,
  );

  const inspectedNode: SkillNode | null = useMemo(
    () => allSkillNodes.find((n) => n.id === inspectedNodeId) ?? null,
    [allSkillNodes, inspectedNodeId],
  );

  const speakSample = (jp: string, speakerId = "aiko") => {
    setPlayingSampleJp(jp);
    setTimeout(() => setPlayingSampleJp((curr) => (curr === jp ? null : curr)), 2400);
    if (onPreviewVoice) {
      onPreviewVoice(jp, speakerId);
      return;
    }
    if (onReplayLine) {
      onReplayLine({ id: 0, speaker: speakerId, jp });
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(jp);
      u.lang = "ja-JP";
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-ink/55 backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={mode === "resume" ? undefined : onClose}
          />
          <motion.div
            className="fixed inset-2 z-50 mx-auto flex max-w-6xl flex-col overflow-hidden rounded-[26px] bg-cream text-ink shadow-2xl sm:inset-4"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 220, damping: 26 }}
          >
            {/* ── Top Header & Primary Scene Action Bar ── */}
            <header className="border-b border-hairline bg-cream-deep/60 px-5 py-4 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
                    Traveler&apos;s Notebook &amp; Codex · 旅の手帳
                  </p>
                  <h2 className="tight mt-0.5 text-2xl font-medium sm:text-3xl">
                    {s.player_name}&apos;s Tokyo Companion
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {mode === "resume" && (
                    <>
                      <button
                        onClick={onClose}
                        className="rounded-full border border-hairline bg-cream px-4 py-2 text-sm font-medium text-ink/75 transition hover:bg-white hover:text-ink"
                      >
                        ← Title Screen
                      </button>
                      {onEnterScene && (
                        <button
                          onClick={onEnterScene}
                          className="flex items-center gap-2 rounded-full bg-shu px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-shu/90"
                        >
                          <span>🎙️ Enter Scene &amp; Speak</span>
                          <span>→</span>
                        </button>
                      )}
                    </>
                  )}

                  {mode === "scorecard" && (
                    <>
                      <button
                        onClick={onClose}
                        className="rounded-full bg-cream px-4 py-2 text-sm font-medium text-ink/80 transition hover:bg-ink hover:text-cream"
                      >
                        ← Back to Scorecard
                      </button>
                      {onNextScene && (
                        <button
                          onClick={onNextScene}
                          className="rounded-full bg-shu px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-shu/90"
                        >
                          Continue to Next Scene →
                        </button>
                      )}
                    </>
                  )}

                  {mode === "ingame" && (
                    <button
                      onClick={onClose}
                      className="flex items-center gap-2 rounded-full bg-ink px-5 py-2 text-sm font-medium text-cream transition hover:bg-ink/90"
                    >
                      <span>🎙️ Return to Scene</span>
                      <span>×</span>
                    </button>
                  )}
                </div>
              </div>

              {/* ── Active Scene Banner (Always visible when resuming or exploring) ── */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-hairline bg-white/85 px-4 py-3 shadow-xs sm:px-5">
                <div className="flex items-center gap-3.5">
                  <div className="flex -space-x-2">
                    {currentPlace.cast.map((cid) => {
                      const c = cast[cid];
                      if (!c) return null;
                      return (
                        <div
                          key={cid}
                          className="h-11 w-11 overflow-hidden rounded-full border-2 border-white bg-cream-deep shadow-xs"
                          title={c.name}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={c.sprite}
                            alt={c.name}
                            className="h-full w-full object-cover object-top"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded-full bg-shu/10 px-2.5 py-0.5 text-[11px] font-semibold text-shu">
                        Current Scene · {currentPlace.clock}
                      </span>
                      <h3 className="tight text-lg font-semibold text-ink">
                        {currentPlace.name}
                      </h3>
                      <span className="font-jp text-sm text-muted">
                        {currentPlace.name_jp}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink/75">
                      <span className="font-medium text-ink">Goal:</span>{" "}
                      {currentPlace.goal}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="rounded-full bg-cream-deep px-3 py-1 font-medium text-ink">
                    ¥{s.yen.toLocaleString()}
                  </span>
                  <span className="rounded-full bg-cream-deep px-3 py-1 font-medium text-ink">
                    🔋 {s.battery}%
                  </span>
                  {mode === "resume" && onEnterScene && (
                    <button
                      onClick={onEnterScene}
                      className="rounded-full bg-ink px-4 py-1.5 font-medium text-cream transition hover:bg-ink/85"
                    >
                      ▶️ Resume Conversation
                    </button>
                  )}
                </div>
              </div>

              {/* ── 5-Tab Navigation Bar ── */}
              <nav className="mt-4 flex gap-1.5 overflow-x-auto pb-0.5">
                {TABS.map((tItem) => {
                  const active = tab === tItem.id;
                  return (
                    <button
                      key={tItem.id}
                      onClick={() => setTab(tItem.id)}
                      className={`relative flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                        active
                          ? "bg-ink text-cream shadow-sm"
                          : "bg-cream text-ink/70 hover:bg-white hover:text-ink"
                      }`}
                    >
                      <span>{tItem.icon}</span>
                      <span>{tItem.label}</span>
                      <span
                        className={`font-jp text-[11px] ${
                          active ? "text-cream/70" : "text-muted"
                        }`}
                      >
                        {tItem.labelJp}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </header>

            {/* ── Main Content Body ── */}
            <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
              {/* ════════════════════════════════════════════════════════════════
                  TAB 1: PEOPLE (登場人物 — Character Dossiers)
                 ════════════════════════════════════════════════════════════════ */}
              {tab === "people" && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="tight text-xl font-semibold">
                        People of Tokyo · 登場人物
                      </h3>
                      <p className="text-sm text-muted">
                        Character dossiers, speaking styles, and how much each person trusts you.
                      </p>
                    </div>
                    <span className="rounded-full bg-cream-deep px-3 py-1 text-xs font-medium text-ink/75">
                      Met {metCastSet.size} of {story.cast.length} characters
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {story.cast.map((c) => {
                      const met = metCastSet.has(c.id);
                      const trust = s.trust?.[c.id] ?? 0;
                      const tBadge = trustLabel(trust);
                      const trustPct = Math.min(100, Math.max(10, 50 + trust * 10));

                      return (
                        <div
                          key={c.id}
                          className={`flex flex-col justify-between rounded-2xl border border-hairline bg-white/80 p-5 shadow-xs transition ${
                            met ? "" : "opacity-75"
                          }`}
                        >
                          <div>
                            <div className="flex items-start gap-4">
                              <div
                                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-hairline bg-cream-deep"
                                style={{ borderColor: c.color }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={c.sprite}
                                  alt={c.name}
                                  className="h-full w-full object-cover object-top"
                                />
                                <span
                                  className="absolute bottom-1 right-1 h-3 w-3 rounded-full border border-white"
                                  style={{ background: c.color }}
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <h4 className="tight text-lg font-semibold text-ink">
                                      {c.name}
                                    </h4>
                                    <p className="font-jp text-xs text-muted">
                                      {c.name_jp}
                                      {c.age ? ` · Age ${c.age}` : ""}
                                    </p>
                                  </div>
                                  <span
                                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                      met ? tBadge.color : "bg-zinc-100 text-zinc-500"
                                    }`}
                                  >
                                    {met ? tBadge.label : "Not Met Yet"}
                                  </span>
                                </div>

                                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-shu">
                                  {c.role}
                                </p>

                                {/* Trust Gauge */}
                                <div className="mt-3">
                                  <div className="flex justify-between text-[11px] text-muted">
                                    <span>Trust Level</span>
                                    <span className="font-semibold text-ink">
                                      {trust >= 0 ? `+${trust}` : trust}
                                    </span>
                                  </div>
                                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream-deep">
                                    <div
                                      className="h-full rounded-full transition-all"
                                      style={{
                                        width: `${trustPct}%`,
                                        background: c.color || "#1c1d20",
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Backstory & Personality */}
                            {c.backstory && (
                              <p className="mt-4 text-sm leading-relaxed text-ink/85">
                                {c.backstory}
                              </p>
                            )}
                            {c.personality && (
                              <p className="mt-2 text-xs text-ink/70">
                                <span className="font-semibold text-ink">Personality:</span>{" "}
                                {c.personality}
                              </p>
                            )}
                          </div>

                          {/* Speech Style Guide (Crucial for Learners) */}
                          <div className="mt-4 space-y-2 rounded-xl bg-cream/90 p-3.5 text-xs">
                            {c.speech_style && (
                              <div>
                                <span className="font-semibold uppercase tracking-wider text-shu">
                                  🗣️ Speaking Style:
                                </span>
                                <p className="mt-0.5 text-ink/85">{c.speech_style}</p>
                              </div>
                            )}
                            {c.helps && (
                              <div className="border-t border-hairline pt-2">
                                <span className="font-semibold uppercase tracking-wider text-muted">
                                  💡 How They Help You:
                                </span>
                                <p className="mt-0.5 text-ink/75">{c.helps}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════════════
                  TAB 2: PLACES (場所 — Tokyo Field Guide)
                 ════════════════════════════════════════════════════════════════ */}
              {tab === "places" && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="tight text-xl font-semibold">
                        Tokyo Field Guide · 場所ガイド
                      </h3>
                      <p className="text-sm text-muted">
                        Locations discovered, story situations, and local vocabulary packs.
                      </p>
                    </div>
                    <span className="rounded-full bg-cream-deep px-3 py-1 text-xs font-medium text-ink/75">
                      Visited {visitedSet.size} of {story.places.length} locations
                    </span>
                  </div>

                  {/* Place Selector Pills */}
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {story.places.map((pl) => {
                      const isVisited = visitedSet.has(pl.id);
                      const isCurrent = pl.id === s.place;
                      const isGoalDone = (s.goals_done ?? []).includes(pl.id);
                      const isSelected = (selectedPlaceId ?? currentPlace.id) === pl.id;

                      return (
                        <button
                          key={pl.id}
                          onClick={() => setSelectedPlaceId(pl.id)}
                          className={`flex shrink-0 items-center gap-2 rounded-2xl border px-3.5 py-2 text-left transition ${
                            isSelected
                              ? "border-ink bg-ink text-cream shadow-sm"
                              : isVisited
                                ? "border-hairline bg-white text-ink hover:bg-cream-deep"
                                : "border-hairline bg-cream/60 text-ink/50 hover:text-ink"
                          }`}
                        >
                          <span className="text-sm">
                            {isCurrent ? "📍" : isGoalDone ? "✓" : isVisited ? "👣" : "🔒"}
                          </span>
                          <div>
                            <p className="text-xs font-semibold leading-tight">{pl.name}</p>
                            <p
                              className={`font-jp text-[10px] ${
                                isSelected ? "text-cream/70" : "text-muted"
                              }`}
                            >
                              {pl.name_jp} · {pl.clock}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Selected Place Detail Card */}
                  {(() => {
                    const pl =
                      story.places.find((p) => p.id === selectedPlaceId) ?? currentPlace;
                    const isVisited = visitedSet.has(pl.id);
                    const isGoalDone = (s.goals_done ?? []).includes(pl.id);
                    const matchingExit = (s.exits ?? []).find((e) => e.to === pl.id);

                    return (
                      <div className="grid gap-5 lg:grid-cols-3">
                        <div className="space-y-4 rounded-2xl border border-hairline bg-white/85 p-5 shadow-xs lg:col-span-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-semibold text-ink">
                                  🕒 {pl.clock}
                                </span>
                                {pl.id === s.place && (
                                  <span className="rounded-full bg-shu px-2.5 py-0.5 text-xs font-semibold text-white">
                                    You Are Here
                                  </span>
                                )}
                                {isGoalDone && (
                                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                                    ✓ Goal Complete
                                  </span>
                                )}
                              </div>
                              <h4 className="tight mt-2 text-2xl font-semibold text-ink">
                                {pl.name}
                              </h4>
                              <p className="font-jp text-sm text-muted">{pl.name_jp}</p>
                            </div>
                            {matchingExit?.open && onTravel && (
                              <button
                                onClick={() => onTravel(pl.id)}
                                className="flex items-center gap-1.5 rounded-full bg-shu px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-shu/90"
                              >
                                🚶 Travel Here →
                              </button>
                            )}
                          </div>

                          {pl.situation && (
                            <div className="rounded-xl bg-cream/70 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                                Situation &amp; Atmosphere
                              </p>
                              <p className="mt-1 text-sm leading-relaxed text-ink/85">
                                {pl.situation}
                              </p>
                            </div>
                          )}

                          <div className="rounded-xl border border-hairline bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wider text-shu">
                              🎯 Objective Here
                            </p>
                            <p className="mt-1 text-sm font-medium text-ink">{pl.goal}</p>
                          </div>

                          {/* People at this location */}
                          {pl.cast.length > 0 && (
                            <div>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                                People Here
                              </p>
                              <div className="flex flex-wrap gap-2.5">
                                {pl.cast.map((cid) => {
                                  const person = cast[cid];
                                  if (!person) return null;
                                  return (
                                    <button
                                      key={cid}
                                      onClick={() => setTab("people")}
                                      className="flex items-center gap-2.5 rounded-xl border border-hairline bg-cream/60 px-3 py-2 text-left transition hover:bg-cream-deep"
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={person.sprite}
                                        alt={person.name}
                                        className="h-9 w-9 rounded-full object-cover object-top"
                                      />
                                      <div>
                                        <p className="text-xs font-semibold text-ink">
                                          {person.name}
                                        </p>
                                        <p className="text-[11px] text-muted">{person.role}</p>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Connected Exits when viewing Current Location */}
                          {pl.id === s.place && (s.exits ?? []).length > 0 && (
                            <div className="border-t border-hairline pt-3">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                                🚪 Available Exits from Here
                              </p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {(s.exits ?? []).map((ex) => (
                                  <div
                                    key={ex.to}
                                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
                                      ex.open
                                        ? "border-hairline bg-cream/60"
                                        : "border-hairline bg-zinc-50 opacity-60"
                                    }`}
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-semibold text-ink">
                                        {ex.name} · <span className="font-jp">{ex.name_jp}</span>
                                      </p>
                                      <p className="truncate text-[11px] text-muted">
                                        {ex.open ? ex.label : ex.locked_reason ?? "Locked"}
                                      </p>
                                    </div>
                                    {ex.open && onTravel && (
                                      <button
                                        onClick={() => onTravel(ex.to)}
                                        className="shrink-0 rounded-full bg-shu px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-shu/90"
                                      >
                                        Go →
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Local Vocabulary Pack Checklist */}
                        <div className="rounded-2xl border border-hairline bg-white/85 p-5 shadow-xs">
                          <div className="flex items-baseline justify-between">
                            <h5 className="tight text-lg font-semibold text-ink">
                              Local Word Pack
                            </h5>
                            <span className="text-xs text-muted">
                              {pl.pack.length} words
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted">
                            Key survival words taught in {pl.name}.
                          </p>

                          {pl.pack.length === 0 ? (
                            <p className="mt-4 text-xs text-muted">
                              Free conversation area — use any words you know!
                            </p>
                          ) : (
                            <ul className="mt-4 space-y-2">
                              {pl.pack.map((w) => {
                                const kw = s.known_words?.[w.jp];
                                const seen = (s.seen_words ?? []).includes(w.jp);
                                const status = kw?.mastered
                                  ? { label: "Mastered ★", cls: "bg-ink text-cream" }
                                  : kw
                                    ? { label: "Looked Up ✓", cls: "bg-emerald-100 text-emerald-800" }
                                    : seen || isVisited
                                      ? { label: "Heard 👀", cls: "bg-amber-100 text-amber-900" }
                                      : { label: "New", cls: "bg-zinc-100 text-zinc-600" };

                                return (
                                  <li
                                    key={w.jp}
                                    className="flex items-center justify-between gap-2 rounded-xl bg-cream/80 px-3.5 py-2.5"
                                  >
                                    <div>
                                      <p className="font-jp text-base font-medium text-ink">
                                        {w.jp}
                                      </p>
                                      <p className="text-xs text-muted">
                                        {w.romaji} · <span className="text-ink/85">{w.en}</span>
                                      </p>
                                    </div>
                                    <span
                                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${status.cls}`}
                                    >
                                      {status.label}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ════════════════════════════════════════════════════════════════
                  TAB 3: PROGRESS & MASTERY (進捗 — Genki RPG Skill Tree & Words)
                 ════════════════════════════════════════════════════════════════ */}
              {tab === "progress" && (
                <div className="space-y-6">
                  {/* Top Summary Metrics */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-2xl border border-emerald-300/60 bg-gradient-to-br from-emerald-50/90 to-white p-4 shadow-2xs">
                      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                        ✨ Skills Awakened
                      </p>
                      <p className="mt-1 text-2xl font-bold text-ink">
                        {unlockedSkillCount}{" "}
                        <span className="text-sm font-normal text-muted">
                          / {allSkillNodes.length} nodes
                        </span>
                      </p>
                    </div>
                    <div className="rounded-2xl border border-amber-300/60 bg-gradient-to-br from-amber-50/90 to-white p-4 shadow-2xs">
                      <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                        ★ Mastery Stars
                      </p>
                      <p className="mt-1 text-2xl font-bold text-ink">
                        {totalMasteryStars}{" "}
                        <span className="text-sm font-normal text-muted">
                          / {allSkillNodes.length * 3} ★
                        </span>
                      </p>
                    </div>
                    <div className="rounded-2xl border border-hairline bg-white/85 p-4">
                      <p className="text-xs uppercase tracking-wider text-muted">
                        Words Mastered
                      </p>
                      <p className="mt-1 text-2xl font-bold text-ink">
                        {wordsMasteredCount}{" "}
                        <span className="text-sm font-normal text-muted">
                          / {wordsList.length} looked up
                        </span>
                      </p>
                    </div>
                    <div className="rounded-2xl border border-hairline bg-white/85 p-4">
                      <p className="text-xs uppercase tracking-wider text-muted">
                        Scenes Cleared
                      </p>
                      <p className="mt-1 text-2xl font-bold text-ink">
                        {(s.goals_done ?? []).length}{" "}
                        <span className="text-sm font-normal text-muted">
                          / {story.places.length}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Active Main Quest */}
                  {currentQuest && (
                    <div className="rounded-2xl border border-shu/25 bg-shu/[0.05] p-4 sm:px-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-shu">
                        🕵️‍♂️ Active Story Investigation
                      </p>
                      <h4 className="tight mt-1 text-lg font-semibold text-ink sm:text-xl">
                        &ldquo;{currentQuest.title}&rdquo;
                      </h4>
                      {currentQuest.title_jp && (
                        <p className="font-jp text-xs text-muted">{currentQuest.title_jp}</p>
                      )}
                    </div>
                  )}

                  {/* ── INTERACTIVE GENKI RPG SKILL TREE ── */}
                  <div className="rounded-3xl border border-hairline bg-white/90 p-5 shadow-xs sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                            Passive Voice RPG Grid
                          </span>
                          <span className="text-xs text-muted">
                            Genki I · Chapter {s.lesson_idx} Active
                          </span>
                        </div>
                        <h3 className="tight mt-1 text-2xl font-semibold text-ink">
                          ⚡ Genki Survival Skill Tree · 言霊スキルツリー
                        </h3>
                        <p className="mt-0.5 text-sm text-muted">
                          Speak any grammar pattern in conversation to passively awaken its node. Click any skill node to inspect your spoken trophy, grammar formula, and practice native voice shadowing.
                        </p>
                      </div>

                      {/* Branch Filter Pills */}
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => setSelectedBranchFilter("all")}
                          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                            selectedBranchFilter === "all"
                              ? "bg-ink text-cream shadow-2xs"
                              : "bg-cream text-ink/70 hover:bg-cream-deep hover:text-ink"
                          }`}
                        >
                          All Branches ({unlockedSkillCount}/{allSkillNodes.length})
                        </button>
                        {SKILL_BRANCHES.map((b) => {
                          const bUnlocked = b.nodes.filter((n) => !!resolvedSkills[n.id]).length;
                          const active = selectedBranchFilter === b.id;
                          return (
                            <button
                              key={b.id}
                              onClick={() => setSelectedBranchFilter(b.id)}
                              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                                active
                                  ? "bg-ink text-cream shadow-2xs"
                                  : "bg-cream text-ink/75 hover:bg-cream-deep hover:text-ink"
                              }`}
                            >
                              <span>{b.icon}</span>
                              <span>{b.title.split(" ")[0]}</span>
                              <span className="opacity-70">
                                {bUnlocked}/{b.nodes.length}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Skill Branches Grid */}
                    <div className="mt-5 space-y-6">
                      {SKILL_BRANCHES.filter(
                        (b) => selectedBranchFilter === "all" || b.id === selectedBranchFilter,
                      ).map((branch) => {
                        const branchUnlockedCount = branch.nodes.filter(
                          (n) => !!resolvedSkills[n.id],
                        ).length;
                        const branchPct = Math.round(
                          (branchUnlockedCount / branch.nodes.length) * 100,
                        );

                        return (
                          <div
                            key={branch.id}
                            className="rounded-2xl border border-hairline bg-cream/40 p-4 sm:p-5"
                          >
                            {/* Branch Header */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5">
                                <span
                                  className="grid h-10 w-10 place-items-center rounded-xl text-xl text-white shadow-2xs"
                                  style={{ background: branch.accent }}
                                >
                                  {branch.icon}
                                </span>
                                <div>
                                  <div className="flex items-baseline gap-2">
                                    <h4 className="tight text-lg font-semibold text-ink">
                                      {branch.title}
                                    </h4>
                                    <span className="font-jp text-xs text-muted">
                                      {branch.title_jp}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted">{branch.subtitle}</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                <div className="w-28 overflow-hidden rounded-full bg-cream-deep h-2">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${branchPct}%`,
                                      background: branch.accent,
                                    }}
                                  />
                                </div>
                                <span className="text-xs font-semibold text-ink">
                                  {branchUnlockedCount} / {branch.nodes.length} Awakened
                                </span>
                              </div>
                            </div>

                            {/* Connected Skill Nodes Row */}
                            <div className="mt-4 grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                              {branch.nodes.map((node, nodeIdx) => {
                                const unlocked = resolvedSkills[node.id];
                                const level = unlocked
                                  ? Math.min(3, Math.max(1, unlocked.mastery_level || 1))
                                  : 0;
                                const isMastered = level >= 3;
                                const stars =
                                  level === 3
                                    ? "★★★"
                                    : level === 2
                                      ? "★★☆"
                                      : level === 1
                                        ? "★☆☆"
                                        : "☆☆☆";

                                return (
                                  <div
                                    key={node.id}
                                    className="relative flex items-stretch"
                                  >
                                    <button
                                      onClick={() => setInspectedNodeId(node.id)}
                                      className={`group relative flex w-full flex-col justify-between rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${
                                        unlocked
                                          ? isMastered
                                            ? "border-amber-400 bg-gradient-to-br from-amber-50/95 via-white to-emerald-50/60 shadow-md ring-1 ring-amber-300/50"
                                            : "border-emerald-400/90 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/40 shadow-sm ring-1 ring-emerald-300/40"
                                          : "border-dashed border-hairline bg-white/65 opacity-85 hover:border-ink/40 hover:bg-white hover:opacity-100"
                                      }`}
                                    >
                                      <div>
                                        {/* Top Row: Icon, Stars & Pronunciation Badge */}
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex items-center gap-2">
                                            <span
                                              className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg ${
                                                unlocked
                                                  ? isMastered
                                                    ? "bg-amber-100 text-amber-900 shadow-2xs"
                                                    : "bg-emerald-100 text-emerald-900 shadow-2xs"
                                                  : "bg-cream-deep text-muted"
                                              }`}
                                            >
                                              {node.icon}
                                            </span>
                                            <div>
                                              <span
                                                className={`text-xs font-bold tracking-widest ${
                                                  unlocked
                                                    ? isMastered
                                                      ? "text-amber-600"
                                                      : "text-emerald-700"
                                                    : "text-zinc-400"
                                                }`}
                                              >
                                                {stars}
                                              </span>
                                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                                                {unlocked
                                                  ? isMastered
                                                    ? "Lv.3 Mastered"
                                                    : `Lv.${level} Awakened`
                                                  : "🔒 Locked Skill"}
                                              </p>
                                            </div>
                                          </div>

                                          {unlocked?.pron_score != null && (
                                            <span className="shrink-0 rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white shadow-2xs">
                                              🎙️ {unlocked.pron_score}%
                                            </span>
                                          )}
                                        </div>

                                        {/* Node Title */}
                                        <div className="mt-3">
                                          <p className="font-jp text-lg font-bold text-ink">
                                            {node.title_jp}
                                          </p>
                                          <h5 className="tight text-sm font-semibold text-ink/90">
                                            {node.title}
                                          </h5>
                                        </div>

                                        {/* Spoken Trophy Snippet or Actionable Unlock Hint */}
                                        {unlocked ? (
                                          <div className="mt-3 rounded-xl border border-emerald-200/80 bg-white/90 px-3 py-2">
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                                              🏆 Spoken Trophy · {unlocked.place_name}
                                            </p>
                                            <p className="mt-0.5 line-clamp-2 font-jp text-xs font-medium text-ink">
                                              &ldquo;{unlocked.sentence}&rdquo;
                                            </p>
                                          </div>
                                        ) : (
                                          <div className="mt-3 rounded-xl bg-cream/85 px-3 py-2">
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-shu">
                                              🎙️ Voice Unlock Hint
                                            </p>
                                            <p className="mt-0.5 text-xs leading-snug text-ink/80">
                                              {node.unlockHint}
                                            </p>
                                          </div>
                                        )}
                                      </div>

                                      {/* Footer CTA */}
                                      <div className="mt-3 flex items-center justify-between border-t border-hairline/70 pt-2 text-[11px] font-semibold text-ink/70 group-hover:text-ink">
                                        <span>
                                          {unlocked
                                            ? "🔊 Shadow & Inspect Trophy"
                                            : "📐 Formula & Voice Samples"}
                                        </span>
                                        <span className="transition-transform group-hover:translate-x-0.5">
                                          →
                                        </span>
                                      </div>
                                    </button>

                                    {/* Connector Arrow to Next Node in Branch */}
                                    {nodeIdx < branch.nodes.length - 1 && (
                                      <div className="hidden items-center px-1 text-muted/60 lg:flex">
                                        <span className="text-sm font-bold">→</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Scorecard Trophy Case & Word Bank */}
                  <div className="grid gap-5 lg:grid-cols-2">
                    {/* Scorecard Trophy Case */}
                    <div className="rounded-2xl border border-hairline bg-white/85 p-5">
                      <h4 className="tight text-lg font-semibold text-ink">
                        🏆 Scene Scorecard Trophy Case ({entries.length})
                      </h4>
                      <p className="text-xs text-muted">
                        Click any completed scene scorecard to review its full Sensei debrief.
                      </p>
                      {entries.length === 0 ? (
                        <p className="mt-4 text-sm text-muted">
                          Complete a scene objective to earn your first S/A/B/C rank scorecard!
                        </p>
                      ) : (
                        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                          {entries.map((entry, idx) => {
                            const r = (entry.rank in RANK_STYLES ? entry.rank : "C") as Rank;
                            const rStyle = RANK_STYLES[r];
                            return (
                              <button
                                key={entry.id}
                                onClick={() => {
                                  setSelectedDiaryId(entry.id);
                                  setTab("diary");
                                }}
                                className="flex items-center justify-between rounded-xl border border-hairline bg-cream/60 p-3 text-left transition hover:bg-cream-deep"
                              >
                                <div>
                                  <p className="text-xs font-semibold text-ink">
                                    {idx + 1}. {entry.place_name}
                                  </p>
                                  <p className="text-[11px] text-muted">
                                    Score {entry.score}/100 · {entry.turns_used} turns
                                  </p>
                                </div>
                                <span
                                  className={`grid h-9 w-9 place-items-center rounded-full text-sm font-bold ${rStyle.bg} ${rStyle.text}`}
                                >
                                  {r}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Word Bank */}
                    <div className="rounded-2xl border border-hairline bg-white/85 p-5">
                      <h4 className="tight text-lg font-semibold text-ink">
                        📚 Word Bank ({wordsList.length})
                      </h4>
                      <p className="text-xs text-muted">
                        Use a looked-up word {OWN_AFTER} times in your own speech to master it.
                      </p>
                      {wordsList.length === 0 ? (
                        <p className="mt-4 text-sm text-muted">
                          Scan character lines with your Jisho dictionary to add words here.
                        </p>
                      ) : (
                        <ul className="mt-4 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                          {wordsList
                            .sort(
                              ([, a], [, b]) =>
                                Number(b.mastered) - Number(a.mastered) ||
                                (b.uses ?? 0) - (a.uses ?? 0),
                            )
                            .map(([jp, w]) => (
                              <li
                                key={jp}
                                className={`rounded-xl px-3 py-2 ${
                                  w.mastered ? "bg-ink text-cream" : "bg-cream/80"
                                }`}
                              >
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="font-jp text-base font-medium">
                                    {jp}
                                  </span>
                                  <span className="text-[10px] uppercase opacity-65">
                                    {w.mastered ? "★ Owned" : w.kind}
                                  </span>
                                </div>
                                <p className="text-xs opacity-65">{w.romaji}</p>
                                <p className="text-xs font-medium">{w.en}</p>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════════════
                  TAB 4: DIARY & JOURNAL (旅日記 — Story Reflections & Debriefs)
                 ════════════════════════════════════════════════════════════════ */}
              {tab === "diary" && (
                <div className="space-y-6">
                  {/* Protagonist's Story Journal Entries */}
                  {run.journal && run.journal.length > 0 && (
                    <div className="rounded-2xl border border-hairline bg-white/85 p-5 shadow-xs">
                      <h3 className="tight text-lg font-semibold text-ink">
                        ✍️ Protagonist&apos;s Story Journal
                      </h3>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {run.journal.map((j) => (
                          <blockquote
                            key={j.seq}
                            className="rounded-xl bg-cream/80 p-3.5 text-sm italic leading-relaxed text-ink/85"
                          >
                            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider not-italic text-muted">
                              Entry #{j.seq}
                            </span>
                            &ldquo;{j.text}&rdquo;
                          </blockquote>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Scene Scorecard Debriefs */}
                  {entries.length === 0 ? (
                    <div className="rounded-2xl border border-hairline bg-white/80 p-8 text-center">
                      <p className="text-3xl">📖</p>
                      <p className="tight mt-2 text-lg font-medium text-ink">
                        No scene debriefs recorded yet
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        Complete a scene&apos;s goal or reach your turn budget to save your scorecard and Sensei coaching debrief here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {entries.map((entry, idx) => {
                          const r = (entry.rank in RANK_STYLES ? entry.rank : "C") as Rank;
                          const rStyle = RANK_STYLES[r];
                          const isSelected = activeDiary?.id === entry.id;
                          return (
                            <button
                              key={entry.id}
                              onClick={() => setSelectedDiaryId(entry.id)}
                              className={`flex shrink-0 items-center gap-2 rounded-2xl px-3.5 py-2 text-left transition ${
                                isSelected
                                  ? "bg-ink text-cream shadow-sm"
                                  : "bg-white text-ink/75 hover:bg-cream-deep"
                              }`}
                            >
                              <span
                                className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${rStyle.bg} ${rStyle.text}`}
                              >
                                {r}
                              </span>
                              <div>
                                <p className="text-xs font-medium leading-tight">
                                  {idx + 1}. {entry.place_name}
                                </p>
                                <p
                                  className={`text-[10px] ${
                                    isSelected ? "text-cream/65" : "text-muted"
                                  }`}
                                >
                                  {entry.score}/100 · {entry.turns_used}t
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {activeDiary && (
                        <div className="rounded-2xl border border-hairline bg-white/85 p-5 shadow-xs">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <div className="flex items-baseline gap-2">
                                <h3 className="tight text-2xl font-medium">
                                  {activeDiary.place_name}
                                </h3>
                                <span className="font-jp text-base text-muted">
                                  {activeDiary.place_name_jp}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs text-muted">
                                {formatDate(activeDiary.created_at)} ·{" "}
                                {activeDiary.turns_used} turns ({activeDiary.voice_turns}{" "}
                                spoken) ·{" "}
                                <span className="capitalize">
                                  {activeDiary.difficulty}
                                </span>{" "}
                                mode
                              </p>
                            </div>

                            {(() => {
                              const r = (
                                activeDiary.rank in RANK_STYLES
                                  ? activeDiary.rank
                                  : "C"
                              ) as Rank;
                              const style = RANK_STYLES[r];
                              return (
                                <div className="flex items-center gap-3">
                                  <div className="text-right">
                                    <p className="text-xs uppercase tracking-wider text-muted">
                                      Final Score
                                    </p>
                                    <p className="text-xl font-bold text-ink">
                                      {activeDiary.score} / 100
                                    </p>
                                  </div>
                                  <div
                                    className={`grid h-12 w-12 place-items-center rounded-full text-2xl font-bold shadow ${style.bg} ${style.text}`}
                                  >
                                    {r}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Metric breakdowns */}
                          {Object.keys(activeDiary.metrics ?? {}).length > 0 && (
                            <div className="mt-4 space-y-2 border-t border-hairline pt-4">
                              {Object.entries(activeDiary.metrics).map(
                                ([label, val]) => (
                                  <div key={label} className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                      <span className="text-ink/80">{label}</span>
                                      <span className="font-medium tabular-nums">
                                        {val}%
                                      </span>
                                    </div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-cream-deep">
                                      <div
                                        className="h-full rounded-full bg-ink transition-all"
                                        style={{
                                          width: `${Math.min(100, Math.max(0, val))}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                          )}

                          {activeDiary.journal && (
                            <p className="mt-4 border-t border-hairline pt-3 text-sm italic text-ink/80">
                              &ldquo;{activeDiary.journal}&rdquo;
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ════════════════════════════════════════════════════════════════
                  TAB 5: SPOKEN LOG (会話履歴 — Full Speech History & Audio Review)
                 ════════════════════════════════════════════════════════════════ */}
              {tab === "log" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="tight text-xl font-semibold">
                        Spoken Dialogue Log &amp; Audio Review · 会話履歴
                      </h3>
                      <p className="text-sm text-muted">
                        Every sentence spoken in your journey, with Sensei feedback and character voice replay.
                      </p>
                    </div>
                    <span className="rounded-full bg-cream-deep px-3 py-1 text-xs font-medium text-ink/75">
                      {allSpokenLines.length} lines recorded
                    </span>
                  </div>

                  {allSpokenLines.length === 0 ? (
                    <p className="text-sm text-muted">No dialogue lines recorded yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {allSpokenLines.map(({ line: l, placeName, feedback: fb, pronScore }, idx) => {
                        const isPlayer = l.speaker === PLAYER;
                        const isNarrator = l.speaker === NARRATOR;
                        const who = isNarrator
                          ? "Narrator"
                          : isPlayer
                            ? s.player_name
                            : cast[l.speaker]?.name ?? l.speaker_name ?? l.speaker;
                        const color = isPlayer
                          ? "#c8202f"
                          : cast[l.speaker]?.color ?? "#555";
                        const badge = fb
                          ? VERDICT_BADGE[fb.verdict] ?? VERDICT_BADGE.none
                          : null;

                        if (isNarrator) {
                          return (
                            <li
                              key={`${l.id}-${idx}`}
                              className="px-2 py-1 text-sm italic text-ink/60"
                            >
                              {l.en}
                            </li>
                          );
                        }

                        return (
                          <li
                            key={`${l.id}-${idx}`}
                            className={`rounded-2xl px-4 py-3.5 ${
                              isPlayer
                                ? "border border-shu/25 bg-shu/[0.04]"
                                : "border border-hairline bg-white/80"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className="text-xs font-semibold uppercase tracking-wider"
                                  style={{ color }}
                                >
                                  {who} {isPlayer && "(You Spoke)"}
                                </span>
                                <span className="text-[11px] text-muted">
                                  · {placeName}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                {isPlayer && pronScore !== undefined && (
                                  <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-[11px] font-medium text-ink">
                                    🎙️ Pronunciation: {pronScore}%
                                  </span>
                                )}
                                {badge && (
                                  <span
                                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${badge.bg} ${badge.text}`}
                                  >
                                    {badge.label}
                                  </span>
                                )}
                                {!isPlayer && l.jp && onReplayLine && (
                                  <button
                                    onClick={() => onReplayLine(l)}
                                    className="rounded-full bg-cream-deep px-3 py-1 text-xs font-medium text-ink transition hover:bg-ink hover:text-cream"
                                  >
                                    🔊 Replay Voice
                                  </button>
                                )}
                              </div>
                            </div>

                            {l.jp && (
                              <p className="mt-1.5 font-jp text-lg font-medium text-ink">
                                {l.jp}
                              </p>
                            )}
                            {l.romaji && (
                              <p className="text-xs text-shu/90">{l.romaji}</p>
                            )}
                            {l.en && (
                              <p className="mt-0.5 text-sm text-ink/75">
                                &ldquo;{l.en}&rdquo;
                              </p>
                            )}

                            {fb &&
                              (fb.note ||
                                fb.better_jp ||
                                (fb.grammar_used?.length ?? 0) > 0) && (
                                <div className="mt-2.5 rounded-xl bg-white px-3.5 py-2.5 text-xs shadow-2xs">
                                  <p className="font-semibold uppercase tracking-wider text-muted">
                                    Sensei Coaching Note
                                  </p>
                                  {fb.note && (
                                    <p className="mt-1 text-sm text-ink/85">
                                      {fb.note}
                                    </p>
                                  )}
                                  {fb.better_jp && (
                                    <div className="mt-2 border-t border-hairline pt-2">
                                      <span className="text-[10px] uppercase tracking-wider text-muted">
                                        Better phrasing:
                                      </span>
                                      <p className="font-jp text-base font-medium text-ink">
                                        {fb.better_jp}
                                      </p>
                                      {fb.better_romaji && (
                                        <p className="text-xs text-shu">
                                          {fb.better_romaji}
                                        </p>
                                      )}
                                      {fb.better_en && (
                                        <p className="text-xs text-ink/70">
                                          &ldquo;{fb.better_en}&rdquo;
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  {fb.grammar_used && fb.grammar_used.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {fb.grammar_used.map((gid) => {
                                        const g = grammar[gid];
                                        return (
                                          <span
                                            key={gid}
                                            className="rounded-md bg-cream-deep px-2 py-0.5 font-jp text-[11px] font-medium text-ink/80"
                                          >
                                            ✓ {g ? `${g.pattern} (${g.meaning})` : gid}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* ════════════════════════════════════════════════════════════════
                INTERACTIVE SKILL NODE INSPECTOR MODAL
               ════════════════════════════════════════════════════════════════ */}
            <AnimatePresence>
              {inspectedNode && (() => {
                const branch = SKILL_BRANCHES.find((b) => b.id === inspectedNode.branch);
                const unlocked = resolvedSkills[inspectedNode.id];
                const level = unlocked
                  ? Math.min(3, Math.max(1, unlocked.mastery_level || 1))
                  : 0;
                const vBadge = unlocked
                  ? VERDICT_BADGE[unlocked.verdict] ?? VERDICT_BADGE.good
                  : null;

                return (
                  <motion.div
                    key={inspectedNode.id}
                    className="fixed inset-0 z-50 grid place-items-center bg-ink/65 p-3 backdrop-blur-xs sm:p-6"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setInspectedNodeId(null)}
                  >
                    <motion.div
                      className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-hairline bg-cream text-ink shadow-2xl"
                      initial={{ scale: 0.94, y: 18, opacity: 0 }}
                      animate={{ scale: 1, y: 0, opacity: 1 }}
                      exit={{ scale: 0.94, y: 18, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 250, damping: 24 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Modal Header */}
                      <div
                        className={`border-b border-hairline px-5 py-4 sm:px-6 ${
                          unlocked
                            ? level >= 3
                              ? "bg-gradient-to-r from-amber-100/80 via-cream to-emerald-50/70"
                              : "bg-gradient-to-r from-emerald-100/75 via-cream to-teal-50/60"
                            : "bg-cream-deep/80"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-3.5">
                            <span
                              className="grid h-13 w-13 shrink-0 place-items-center rounded-2xl text-2xl text-white shadow-sm"
                              style={{ background: branch?.accent ?? "#10b981" }}
                            >
                              {inspectedNode.icon}
                            </span>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                {branch && (
                                  <span className="rounded-full bg-white/85 px-2.5 py-0.5 text-[11px] font-semibold text-ink/80">
                                    {branch.icon} {branch.title}
                                  </span>
                                )}
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                    unlocked
                                      ? level >= 3
                                        ? "bg-amber-500 text-white"
                                        : "bg-emerald-700 text-white"
                                      : "bg-zinc-200 text-zinc-700"
                                  }`}
                                >
                                  {unlocked
                                    ? level >= 3
                                      ? "★★★ Lv.3 Mastered"
                                      : `★ Lv.${level} Awakened`
                                    : "🔒 Locked Skill Node"}
                                </span>
                              </div>
                              <h3 className="tight mt-1 text-2xl font-bold text-ink">
                                <span className="font-jp">{inspectedNode.title_jp}</span> ·{" "}
                                {inspectedNode.title}
                              </h3>
                            </div>
                          </div>

                          <button
                            onClick={() => setInspectedNodeId(null)}
                            className="rounded-full bg-white/85 px-3.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-ink hover:text-cream"
                          >
                            Close ×
                          </button>
                        </div>
                      </div>

                      {/* Modal Scrollable Body */}
                      <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
                        {/* 1. YOUR SPOKEN TROPHY (or Voice Unlock Challenge) */}
                        {unlocked ? (
                          <div className="rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-50/90 via-white to-amber-50/40 p-4 shadow-2xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                                🏆 Your Spoken Trophy · Unlocked in {unlocked.place_name}
                              </span>
                              <div className="flex items-center gap-2">
                                {unlocked.pron_score != null && (
                                  <span className="rounded-full bg-emerald-700 px-2.5 py-0.5 text-xs font-bold text-white">
                                    🎙️ {unlocked.pron_score}% Pronunciation
                                  </span>
                                )}
                                {vBadge && (
                                  <span
                                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${vBadge.bg} ${vBadge.text}`}
                                  >
                                    {vBadge.label}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/95 px-4 py-3 shadow-2xs">
                              <div>
                                <p className="font-jp text-xl font-bold text-ink">
                                  &ldquo;{unlocked.sentence}&rdquo;
                                </p>
                                <p className="mt-0.5 text-xs text-muted">
                                  Spoken {unlocked.uses} time{unlocked.uses === 1 ? "" : "s"} in conversation
                                  {unlocked.timestamp ? ` · ${formatDate(unlocked.timestamp)}` : ""}
                                </p>
                              </div>
                              {unlocked.sentence && (
                                <button
                                  onClick={() => speakSample(unlocked.sentence, "aiko")}
                                  className="shrink-0 rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-cream transition hover:bg-shu"
                                >
                                  {playingSampleJp === unlocked.sentence
                                    ? "🔊 Playing..."
                                    : "🔊 Hear Native Model"}
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-shu/30 bg-shu/[0.05] p-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-shu">
                              🎙️ How to Unlock Passively in Conversation
                            </p>
                            <p className="mt-1 text-sm font-medium text-ink">
                              {inspectedNode.unlockHint}
                            </p>
                            <p className="mt-1 font-jp text-sm text-ink/80">
                              Try saying: <span className="font-bold">{inspectedNode.unlockHintJp}</span>
                            </p>
                          </div>
                        )}

                        {/* 2. MASTERY GAUGE (Level 1 -> Level 2 -> Level 3) */}
                        <div className="rounded-2xl border border-hairline bg-white/90 p-4">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted">
                              ⭐ RPG Mastery Gauge
                            </p>
                            <span className="text-xs font-semibold text-ink">
                              Level {level} / 3
                            </span>
                          </div>
                          <div className="mt-2.5 grid grid-cols-3 gap-2">
                            {[
                              {
                                lv: 1,
                                title: "Lv.1 Awakened",
                                desc: "Spoken once in conversation",
                              },
                              {
                                lv: 2,
                                title: "Lv.2 Seasoned",
                                desc: "Spoken across 2 scenes",
                              },
                              {
                                lv: 3,
                                title: "Lv.3 Mastered",
                                desc: "Mastered across 3+ visits",
                              },
                            ].map((tier) => {
                              const active = level >= tier.lv;
                              return (
                                <div
                                  key={tier.lv}
                                  className={`rounded-xl border px-3 py-2.5 text-xs transition ${
                                    active
                                      ? tier.lv === 3
                                        ? "border-amber-400 bg-amber-50 text-amber-950"
                                        : "border-emerald-400 bg-emerald-50 text-emerald-950"
                                      : "border-hairline bg-cream/50 text-muted"
                                  }`}
                                >
                                  <p className="font-bold">
                                    {active ? "★" : "☆"} {tier.title}
                                  </p>
                                  <p className="mt-0.5 text-[11px] opacity-80">{tier.desc}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* 3. GRAMMAR FORMULA CARD & CAN-DO GOALS */}
                        <div className="rounded-2xl border border-hairline bg-white/90 p-4">
                          <p className="text-xs font-bold uppercase tracking-wider text-shu">
                            📐 Grammar Formula &amp; Pattern Breakdown
                          </p>
                          <div className="mt-2 rounded-xl bg-ink px-4 py-3 text-cream">
                            <p className="font-jp text-lg font-bold">{inspectedNode.formula}</p>
                          </div>
                          <p className="mt-2.5 text-sm leading-relaxed text-ink/85">
                            {inspectedNode.explanation}
                          </p>

                          {/* Linked Grammar Points from story.toml */}
                          <div className="mt-3 space-y-2 border-t border-hairline pt-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                              Genki Grammar Patterns &amp; Can-Do Checkpoints
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {inspectedNode.grammarIds.map((gid) => {
                                const gp = grammar[gid];
                                if (!gp) return null;
                                const count = s.grammar_counts?.[gid] ?? 0;
                                return (
                                  <div
                                    key={gid}
                                    className="rounded-xl bg-cream/75 px-3 py-2 text-xs"
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="font-jp font-bold text-ink">
                                        {gp.pattern}
                                      </span>
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                          count > 0
                                            ? "bg-emerald-100 text-emerald-800"
                                            : "bg-zinc-100 text-zinc-600"
                                        }`}
                                      >
                                        {count > 0 ? `✓ Used ${count}×` : "Target"}
                                      </span>
                                    </div>
                                    <p className="mt-0.5 text-[11px] text-ink/75">{gp.meaning}</p>
                                  </div>
                                );
                              })}
                            </div>

                            {inspectedNode.candoIds.length > 0 && (
                              <ul className="mt-2 space-y-1.5">
                                {inspectedNode.candoIds.map((cid) => {
                                  const cd = allCanDosMap[cid];
                                  if (!cd) return null;
                                  const done = candosDone.has(cid);
                                  return (
                                    <li
                                      key={cid}
                                      className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-white px-3 py-2 text-xs"
                                    >
                                      <div>
                                        <span
                                          className={
                                            done
                                              ? "font-bold text-emerald-700"
                                              : "font-semibold text-muted"
                                          }
                                        >
                                          {done ? "✓" : "○"}
                                        </span>{" "}
                                        <span className="font-medium text-ink">{cd.text}</span>
                                        <span className="ml-2 font-jp text-muted">
                                          ({cd.example})
                                        </span>
                                      </div>
                                      <button
                                        onClick={() => speakSample(cd.example, "aiko")}
                                        className="shrink-0 rounded-full bg-cream-deep px-2.5 py-1 text-[11px] font-semibold text-ink transition hover:bg-ink hover:text-cream"
                                      >
                                        🔊
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        </div>

                        {/* 4. NATIVE VOICE PRACTICE & SHADOWING */}
                        <div className="rounded-2xl border border-hairline bg-white/90 p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider text-ink">
                                🔊 Voice Practice &amp; Shadowing
                              </p>
                              <p className="text-xs text-muted">
                                Tap to hear native character pronunciation and repeat aloud to practice.
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 space-y-2.5">
                            {inspectedNode.examples.map((ex, i) => {
                              const char = cast[ex.speakerId];
                              const isPlaying = playingSampleJp === ex.jp;
                              return (
                                <div
                                  key={i}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-cream/65 p-3.5"
                                >
                                  <div className="flex items-start gap-3">
                                    {char?.sprite && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={char.sprite}
                                        alt={char.name}
                                        className="h-10 w-10 shrink-0 rounded-full border border-white bg-cream-deep object-cover object-top"
                                      />
                                    )}
                                    <div>
                                      <p className="text-[11px] font-semibold uppercase tracking-wider text-shu">
                                        {char?.name ?? ex.speakerName}
                                      </p>
                                      <p className="font-jp text-base font-bold text-ink">
                                        {ex.jp}
                                      </p>
                                      <p className="text-xs text-shu/90">{ex.romaji}</p>
                                      <p className="text-xs text-ink/75">&ldquo;{ex.en}&rdquo;</p>
                                    </div>
                                  </div>

                                  <button
                                    onClick={() => speakSample(ex.jp, ex.speakerId)}
                                    className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold shadow-2xs transition ${
                                      isPlaying
                                        ? "bg-shu text-white"
                                        : "bg-ink text-cream hover:bg-shu"
                                    }`}
                                  >
                                    <span>🔊</span>
                                    <span>{isPlaying ? "Playing..." : "Listen & Shadow"}</span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </motion.div>
                );
              })()}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
