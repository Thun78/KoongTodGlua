// Typed client for replay-engine. Base URL is baked at build time;
// the default works via docker-compose's 8000:8000 port mapping since
// the browser calls it from the host machine.
const BASE =
  process.env.NEXT_PUBLIC_REPLAY_ENGINE_URL ?? "http://localhost:8000";

export interface MatchInfo {
  match_id: number;
  home_team: string;
  away_team: string;
  label: string;
  date: string;
  regulation_score: [number, number];
}

export interface TimelineEvent {
  display_min: number;
  minute: number;
  type: "goal" | "card" | "chance";
  team: string;
  player: string;
  label: string;
}

export interface Snapshot {
  minute: number;
  score: [number, number];
  xg: [number, number];
  shots: [number, number];
  corners: [number, number];
  cards: [number, number];
  fouls: [number, number];
  possession_split: [number, number];
  pressing: [number, number];
  momentum: number;
  foul_flurry: boolean;
  formations: [string, string];
  shots_accumulated: number;
  momentum_10m: string;
  pressing_intensity: string;
}

export interface Season {
  season_id: number;
  season_name: string;
}

export interface CompetitionSeasons {
  competition_id: number;
  competition_name: string;
  seasons: Season[];
}

export interface CatalogMatch {
  match_id: number;
  date: string;
  stage: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`replay-engine ${path}: ${res.status}`);
  return res.json();
}

export const getMatches = () => get<MatchInfo[]>("/matches");
export const getTimeline = (id: number) =>
  get<TimelineEvent[]>(`/matches/${id}/timeline`);
export const getSnapshots = (id: number) =>
  get<Snapshot[]>(`/matches/${id}/snapshots`);
export const getCompetitions = () =>
  get<CompetitionSeasons[]>("/catalog/competitions");
export const getCatalogMatches = (competitionId: number, seasonId: number) =>
  get<CatalogMatch[]>(
    `/catalog/matches?competition_id=${competitionId}&season_id=${seasonId}`,
  );

/** Layer 2 living-pitch row: [t, x, y, code, side, endX, endY].
 * Coordinates are pre-normalized server-side (home attacks x→120,
 * away x→0) — never flip client-side. endX/endY null except
 * pass/carry/shot. */
export type FlowRow = [
  number,
  number,
  number,
  string,
  "h" | "a",
  number | null,
  number | null,
];

export const getFlow = (matchId: number) =>
  get<FlowRow[]>(`/matches/${matchId}/flow`);

export interface ScorePair {
  home: number;
  away: number;
}

export interface LLMPrediction {
  predicted_final_score: ScorePair;
  predicted_final_possession: ScorePair;
  predicted_final_corners: ScorePair;
  predicted_final_yellow_cards: ScorePair;
  curated_panels: string[];
}

export async function postPredict(
  matchId: number,
  minute: number,
  persona: string,
): Promise<LLMPrediction> {
  const res = await fetch(
    `${BASE}/matches/${matchId}/predict?minute=${minute}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona }),
    },
  );
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d.detail)
      .catch(() => res.statusText);
    throw new Error(String(detail));
  }
  return res.json();
}

export interface Capabilities {
  reconstruction_upload: boolean;
}

export interface HealthInfo {
  status: string;
  matches_loaded: number;
  capabilities: Capabilities;
}

export interface ClipStatus {
  status: "queued" | "reconstructing" | "ready" | "failed";
  filename: string;
  uploaded_at: string;
  error?: string;
}

export const getHealth = () => get<HealthInfo>("/health");
export const getClipStatuses = (matchId: number) =>
  get<Record<string, ClipStatus>>(`/matches/${matchId}/clips`);

export async function uploadClip(
  matchId: number,
  minute: number,
  file: File,
): Promise<ClipStatus> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${BASE}/matches/${matchId}/goals/${minute}/clip`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d.detail)
      .catch(() => res.statusText);
    throw new Error(String(detail));
  }
  return res.json();
}

export async function deleteMatch(matchId: number): Promise<void> {
  const res = await fetch(`${BASE}/matches/${matchId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`delete failed: ${res.status}`);
  }
}

export async function addMatch(
  competitionId: number,
  seasonId: number,
  matchId: number,
): Promise<MatchInfo> {
  const res = await fetch(`${BASE}/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      competition_id: competitionId,
      season_id: seasonId,
      match_id: matchId,
    }),
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d.detail)
      .catch(() => res.statusText);
    throw new Error(String(detail));
  }
  return res.json();
}
