// Domain store for the match viewer, mirroring the caipe-ui
// one-zustand-store-per-domain convention. Holds the state machine:
// screen routing, the client-owned match clock, playback, the 3D-replay
// overlay, and the replay-engine catalog / active-match data.

import { create } from "zustand";
import {
  AUTO_REPLAY,
  REPLAY_DELAY_MIN,
  type CameraId,
  type PersonaId,
} from "@/lib/match-data";
import type {
  FlowRow,
  MatchInfo,
  Snapshot,
  TimelineEvent,
} from "@/lib/replay-client";

export type Screen = "home" | "persona" | "viewer" | "addMatch";

interface MatchState {
  screen: Screen;
  persona: PersonaId | null;
  /** how the persona picker was reached, so its own back button knows
   * where to return to: the match card (→ home) or Settings (→ viewer) */
  personaPickerOrigin: "home" | "settings";
  minute: number;
  playing: boolean;
  /** playback rate as a multiple of real time (1 = live broadcast pace) */
  speed: number;
  camera: CameraId;
  slow: boolean;
  replayEvent: TimelineEvent | null;
  /** goal minutes already auto-replayed */
  seenGoals: Record<number, boolean>;

  // catalog / active match (loaded via replay-client)
  catalog: MatchInfo[] | null;
  catalogOffline: boolean;
  activeMatch: MatchInfo | null;
  matchTimeline: TimelineEvent[];
  matchSnapshots: Snapshot[];
  matchFlow: FlowRow[];

  setCatalog: (matches: MatchInfo[], offline?: boolean) => void;
  setMatchData: (
    snapshots: Snapshot[],
    timeline: TimelineEvent[],
    flow: FlowRow[],
  ) => void;
  openAddMatch: () => void;
  enterMatch: (match: MatchInfo) => void;
  backHome: () => void;
  pickPersona: (id: PersonaId) => void;
  openSettings: () => void;
  /** persona screen's own back button */
  leavePersonaPicker: () => void;
  togglePlay: () => void;
  setSpeed: (v: number) => void;
  /** advance the clock one 500ms tick; auto-opens goal replays */
  tick: () => void;
  /** scrub/seek to a minute; goals behind the playhead won't re-fire */
  seek: (minute: number) => void;
  jumpToEvent: (ev: TimelineEvent) => void;
  closeReplay: () => void;
  setCamera: (id: CameraId) => void;
  toggleSlow: () => void;
}

const goalsSeenUpTo = (timeline: TimelineEvent[], minute: number) => {
  const seen: Record<number, boolean> = {};
  for (const e of timeline) {
    if (e.type === "goal" && e.minute <= minute) seen[e.minute] = true;
  }
  return seen;
};

export const useMatchStore = create<MatchState>((set) => ({
  screen: "home",
  persona: null,
  personaPickerOrigin: "home",
  minute: 0,
  playing: false,
  speed: 1,
  camera: "keeper",
  slow: false,
  replayEvent: null,
  seenGoals: {},
  catalog: null,
  catalogOffline: false,
  activeMatch: null,
  matchTimeline: [],
  matchSnapshots: [],
  matchFlow: [],

  setCatalog: (matches, offline = false) =>
    set({ catalog: matches, catalogOffline: offline }),
  setMatchData: (snapshots, timeline, flow) =>
    set({ matchSnapshots: snapshots, matchTimeline: timeline, matchFlow: flow }),
  openAddMatch: () => set({ screen: "addMatch" }),
  enterMatch: (match) =>
    set({
      activeMatch: match,
      screen: "persona",
      personaPickerOrigin: "home",
      minute: 0,
      speed: 1, // always start a match at real-time pace (60× is sticky otherwise)
      seenGoals: {},
      replayEvent: null,
      matchSnapshots: [],
      matchTimeline: [],
      matchFlow: [],
    }),
  backHome: () => set({ screen: "home", playing: false }),
  pickPersona: (id) => set({ screen: "viewer", persona: id, playing: true }),
  openSettings: () =>
    set({ screen: "persona", playing: false, personaPickerOrigin: "settings" }),
  leavePersonaPicker: () =>
    set((s) =>
      s.personaPickerOrigin === "settings"
        ? { screen: "viewer", playing: true }
        : { screen: "home", playing: false },
    ),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (v) => set({ speed: v }),

  tick: () =>
    set((s) => {
      // don't advance while the replay overlay is open or before match
      // data has loaded (otherwise kickoff is missed during the splash)
      if (!s.playing || s.replayEvent || s.matchSnapshots.length === 0) return s;
      // 500ms tick at speed× real time = speed * 0.5 real seconds of match
      const minute = Math.min(90, s.minute + (s.speed * 0.5) / 60);
      const next: Partial<MatchState> = {
        minute,
        playing: minute < 90 ? s.playing : false,
      };
      if (AUTO_REPLAY) {
        // fire a beat after the goal so it plays out on the pitch first
        // (clamped so late goals still trigger before the clock stops)
        const goal = s.matchTimeline.find(
          (e) =>
            e.type === "goal" &&
            minute >= Math.min(e.minute + REPLAY_DELAY_MIN, 89.8) &&
            !s.seenGoals[e.minute],
        );
        if (goal) {
          next.replayEvent = goal;
          next.seenGoals = { ...s.seenGoals, [goal.minute]: true };
          next.camera = "keeper";
          next.slow = false;
        }
      }
      return { ...s, ...next };
    }),

  seek: (minute) =>
    set((s) => ({
      minute,
      seenGoals: goalsSeenUpTo(s.matchTimeline, minute),
      replayEvent: null,
    })),

  jumpToEvent: (ev) =>
    set((s) => ({
      minute: ev.minute,
      seenGoals: goalsSeenUpTo(s.matchTimeline, ev.minute),
      replayEvent: ev.type === "goal" ? ev : null,
      camera: "keeper",
      slow: false,
    })),

  closeReplay: () => set({ replayEvent: null, playing: true }),
  setCamera: (id) => set({ camera: id }),
  toggleSlow: () => set((s) => ({ slow: !s.slow })),
}));

/** Snapshot at (nearest half-minute to) `minute`; null while loading. */
export function snapshotAt(
  snapshots: Snapshot[],
  minute: number,
): Snapshot | null {
  if (snapshots.length === 0) return null;
  const idx = Math.min(
    snapshots.length - 1,
    Math.max(0, Math.round(minute * 2)),
  );
  return snapshots[idx];
}
