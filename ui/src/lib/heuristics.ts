// Client-side stand-ins for the two Gemma jobs until model-svc lands.
// predictFinal is DESIGN.md's rate-extrapolation fallback; visibleStats
// is the heuristic persona-curation rule set. Both consume real
// replay-engine snapshots.

import type { PersonaId } from "@/lib/match-data";
import type { Snapshot } from "@/lib/replay-client";

// League-average priors (per team, 90') blended in before ~20'
const PRIOR = { goals: 1.3, corners: 5, cards: 2 };

export interface Prediction {
  score: string;
  corners: number;
  cards: number;
  possA: number;
  rationale: string;
}

export function predictFinal(snap: Snapshot): Prediction {
  const m = Math.max(snap.minute, 1);
  const w = Math.min(1, m / 20); // trust extrapolation fully from 20'
  const proj = (v: number, prior: number) =>
    Math.round(w * (v / m) * 90 + (1 - w) * prior);
  const h = Math.max(snap.score[0], proj(snap.score[0], PRIOR.goals));
  const a = Math.max(snap.score[1], proj(snap.score[1], PRIOR.goals));
  return {
    score: `${h} – ${a}`,
    corners: Math.max(
      snap.corners[0] + snap.corners[1],
      proj(snap.corners[0], PRIOR.corners) + proj(snap.corners[1], PRIOR.corners),
    ),
    cards: Math.max(
      snap.cards[0] + snap.cards[1],
      proj(snap.cards[0], PRIOR.cards) + proj(snap.cards[1], PRIOR.cards),
    ),
    possA: snap.possession_split[0],
    rationale:
      "Rate extrapolation of live stats to 90' (heuristic baseline — Gemma 4 takes over when model-svc lands).",
  };
}

export interface StatCard {
  label: string;
  arg: string | number;
  mid: string;
  fra: string | number;
  badge?: string | null;
}

export interface VisibleStats {
  list: StatCard[];
  hidden: number;
}

export function visibleStats(
  persona: PersonaId,
  snap: Snapshot,
  minute: number,
): VisibleStats {
  const S: Record<string, StatCard> = {
    score: { label: "SCORE", arg: snap.score[0], mid: "goals", fra: snap.score[1] },
    xg: {
      label: "EXPECTED GOALS (xG)",
      arg: snap.xg[0].toFixed(2),
      mid: "xG",
      fra: snap.xg[1].toFixed(2),
    },
    shots: { label: "SHOTS", arg: snap.shots[0], mid: "total", fra: snap.shots[1] },
    poss: {
      label: "POSSESSION",
      arg: `${snap.possession_split[0]}%`,
      mid: "ball",
      fra: `${snap.possession_split[1]}%`,
    },
    press: {
      label: "PRESSING INTENSITY",
      arg: snap.pressing[0].toFixed(1),
      mid: "per poss.",
      fra: snap.pressing[1].toFixed(1),
    },
    form: {
      label: "FORMATIONS",
      arg: snap.formations[0],
      mid: "shape",
      fra: snap.formations[1],
    },
    corners: { label: "CORNERS", arg: snap.corners[0], mid: "won", fra: snap.corners[1] },
    cards: {
      label: "CARDS",
      arg: snap.cards[0],
      mid: "cards",
      fra: snap.cards[1],
      badge: snap.foul_flurry ? "FOULS SPIKING" : null,
    },
    fouls: { label: "FOULS", arg: snap.fouls[0], mid: "committed", fra: snap.fouls[1] },
  };
  let keys: string[];
  if (persona === "casual") {
    keys = ["score", "shots"];
    if (snap.foul_flurry) keys.push("cards");
  } else if (persona === "analyst") {
    keys = ["xg", "press", "form", "poss"];
    if (snap.foul_flurry) keys.push("fouls");
  } else {
    keys = ["cards", "corners", "fouls"];
    if (minute > 70) keys.push("shots");
  }
  return {
    list: keys.map((k) => ({ badge: null, ...S[k] })),
    hidden: Object.keys(S).length - keys.length,
  };
}
