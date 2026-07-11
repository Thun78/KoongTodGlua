// Static UI fixtures. Match events and stats now come from replay-engine
// (see src/lib/replay-client.ts); what remains here is genuinely static:
// personas, replay camera presets, playback speeds, behavior flags.

export type PersonaId = "casual" | "analyst" | "bettor";

export interface Persona {
  name: string;
  tag: string;
  desc: string;
  statsHint: string;
}

export const PERSONAS: Record<PersonaId, Persona> = {
  casual: {
    name: "Casual Fan",
    tag: "01 / DEFAULT",
    desc: "A clean screen. Score, time and momentum — nothing else fighting for your attention.",
    statsHint: "score · time · momentum",
  },
  analyst: {
    name: "Analyst",
    tag: "02 / TACTICAL",
    desc: "The tactical layer. Expected goals, pressing intensity, formations and possession.",
    statsHint: "xG · pressing · formations · possession",
  },
  bettor: {
    name: "Bettor",
    tag: "03 / MARKETS",
    desc: "What moves the markets. Cards, corners, and the model’s running final-stat predictions.",
    statsHint: "cards · corners · predicted finals",
  },
};

export const PERSONA_IDS: PersonaId[] = ["casual", "analyst", "bettor"];

export type CameraId = "keeper" | "aerial" | "touchline";

export const CAMERAS: { id: CameraId; label: string }[] = [
  { id: "keeper", label: "Behind keeper" },
  { id: "aerial", label: "Aerial" },
  { id: "touchline", label: "Touchline" },
];

/** Playback speeds as multiples of real time (1 = live broadcast pace).
 * The high multipliers exist because a real match is 90 minutes — demos
 * and judges need a way to reach the goals without waiting. */
export const SPEEDS = [0.5, 1, 2, 60];

/** Behavior toggles (props in the original design component). */
export const AUTO_REPLAY = true;
export const SHOW_RATIONALE = true;

/** Let the goal play out on the pitch before the 3D replay takes over
 * (match-minutes; ~8s of match time). */
export const REPLAY_DELAY_MIN = 8 / 60;
