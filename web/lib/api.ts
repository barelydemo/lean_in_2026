import type { AudioManifest } from "./audio/engine";
import type { Course, DiaryEntry, DiaryLineFeedback, Gloss, InputVia, PronunciationAssessment, Run, RunState, SceneScoreRow, Story, Translation, TravelResult, TurnResult } from "./types";

export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface TurnRequest {
  text: string;
  via: InputVia;
  difficulty: Difficulty;
  pron_score?: number;
}

export interface SceneScorePayload {
  place_id: string;
  place_name: string;
  place_name_jp: string;
  rank: string;
  score: number;
  turns_used: number;
  voice_turns: number;
  difficulty: Difficulty;
  metrics: Record<string, number>;
  feedbacks: DiaryLineFeedback[];
  journal?: string;
}

export interface SceneScoreResponse {
  reward_battery: number;
  reward_trust: string[];
  diary_entry: DiaryEntry;
  scene_scores: SceneScoreRow[];
  state: RunState;
}

export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8085").replace(/\/$/, "");
const API = API_ORIGIN + "/api/v1";
const TOKEN_KEY = "lexical.token";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode: the session still works until the tab closes.
  }
}

let memoryToken: string | null = null;

/** Returns a guest token, creating a guest player on first visit. */
async function token(): Promise<string> {
  memoryToken ??= readToken();
  if (memoryToken) return memoryToken;
  const res = await fetch(`${API}/players`, { method: "POST" });
  if (!res.ok) throw await toError(res);
  const { token } = (await res.json()) as { token: string };
  memoryToken = token;
  writeToken(token);
  return token;
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error: string; message: string };
    return new ApiError(res.status, body.error, body.message);
  } catch {
    return new ApiError(res.status, "unknown", res.statusText);
  }
}

async function call<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await token()}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (res.status === 401 && !retried) {
    // Token was revoked or the database was reset: start a fresh guest.
    memoryToken = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    return call<T>(path, init, true);
  }
  if (!res.ok) throw await toError(res);
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.blob()) as Promise<T>;
}

export const api = {
  courses: async () => {
    const res = await fetch(`${API}/courses`);
    if (!res.ok) throw await toError(res);
    return (await res.json()) as { courses: Course[]; default: string };
  },

  story: async (course: string) => {
    const res = await fetch(`${API}/story?course=${encodeURIComponent(course)}`);
    if (!res.ok) throw await toError(res);
    return (await res.json()) as { story: Story; tts_enabled: boolean; stt_enabled: boolean };
  },

  audioManifest: async (): Promise<AudioManifest> => {
    try {
      const res = await fetch(`${API}/audio`);
      if (res.ok) return (await res.json()) as AudioManifest;
    } catch {}
    return { music: {}, ambience: {}, sfx: {} };
  },

  currentRun: (course: string) => call<Run | null>(`/runs/current?course=${encodeURIComponent(course)}`),

  newRun: (player_name: string, course: string) =>
    call<Run>("/runs", { method: "POST", body: JSON.stringify({ player_name, course }) }),

  turn: (runId: string, text: string, via: InputVia, difficulty: Difficulty = "beginner", pron_score?: number) => {
    const body: TurnRequest = { text, via, difficulty, ...(typeof pron_score === "number" ? { pron_score: Math.round(pron_score) } : {}) };
    return call<TurnResult>(`/runs/${runId}/turn`, { method: "POST", body: JSON.stringify(body) });
  },

  recordScore: (runId: string, payload: SceneScorePayload) =>
    call<SceneScoreResponse>(`/runs/${runId}/score`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  scan: (runId: string, line_id: number) =>
    call<{ line_id: number; gloss: Gloss; cost: number; state: RunState }>(`/runs/${runId}/scan`, {
      method: "POST",
      body: JSON.stringify({ line_id }),
    }),

  travel: (runId: string, to: string, difficulty: Difficulty = "beginner") =>
    call<TravelResult>(`/runs/${runId}/travel`, { method: "POST", body: JSON.stringify({ to, difficulty }) }),

  translate: (runId: string, text: string) =>
    call<{ translation: Translation; cost: number; state: RunState }>(`/runs/${runId}/translate`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  hint: (runId: string) => call<{ state: RunState }>(`/runs/${runId}/hint`, { method: "POST" }),

  tts: (line_id: number) => call<Blob>("/tts", { method: "POST", body: JSON.stringify({ line_id }) }),

  ttsPreview: (text: string, speaker?: string, course?: string) =>
    call<Blob>("/tts/preview", { method: "POST", body: JSON.stringify({ text, speaker, course }) }),

  stt: (audio: Blob, reference?: string) => {
    const form = new FormData();
    const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
    form.append("audio", audio, `speech.${ext}`);
    if (reference) form.append("reference", reference);
    return call<{ text: string; pronunciation?: PronunciationAssessment }>("/stt", { method: "POST", body: form });
  },
};
