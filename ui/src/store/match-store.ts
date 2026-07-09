// Domain store for the match viewer, mirroring the caipe-ui
// one-zustand-store-per-domain convention. Holds the state machine
// ported from the design component: screen routing, match clock,
// playback, and the 3D-replay overlay.

import { create } from "zustand";
import {
  AUTO_REPLAY,
  EVENTS,
  type CameraId,
  type MatchEvent,
  type PersonaId,
} from "@/lib/match-data";

export type Screen = "home" | "persona" | "viewer";

interface MatchState {
  screen: Screen;
  persona: PersonaId | null;
  minute: number;
  playing: boolean;
  /** match-minutes advanced per real second */
  speed: number;
  replayEvent: MatchEvent | null;
  camera: CameraId;
  slow: boolean;
  /** goal minutes already auto-replayed */
  seenGoals: Record<number, boolean>;

  enterMatch: () => void;
  backHome: () => void;
  pickPersona: (id: PersonaId) => void;
  openSettings: () => void;
  /** persona screen's own back button: returns to the viewer if a
   * persona is already picked (i.e. we arrived via Settings), otherwise
   * to home (first-time entry from the match card). */
  leavePersonaPicker: () => void;
  togglePlay: () => void;
  setSpeed: (v: number) => void;
  /** advance the clock one 500ms tick; auto-opens goal replays */
  tick: () => void;
  /** scrub/seek to a minute; goals behind the playhead won't re-fire */
  seek: (minute: number) => void;
  jumpToEvent: (ev: MatchEvent) => void;
  closeReplay: () => void;
  setCamera: (id: CameraId) => void;
  toggleSlow: () => void;
}

const goalsSeenUpTo = (minute: number): Record<number, boolean> => {
  const seen: Record<number, boolean> = {};
  for (const e of EVENTS) {
    if (e.type === "goal" && e.min <= minute) seen[e.min] = true;
  }
  return seen;
};

export const useMatchStore = create<MatchState>((set) => ({
  screen: "home",
  persona: null,
  minute: 0,
  playing: false,
  speed: 1,
  replayEvent: null,
  camera: "keeper",
  slow: false,
  seenGoals: {},

  enterMatch: () => set({ screen: "persona" }),
  backHome: () => set({ screen: "home", playing: false }),
  pickPersona: (id) => set({ screen: "viewer", persona: id, playing: true }),
  openSettings: () => set({ screen: "persona", playing: false }),
  leavePersonaPicker: () =>
    set((s) =>
      s.persona
        ? { screen: "viewer", playing: true }
        : { screen: "home", playing: false },
    ),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (v) => set({ speed: v }),

  tick: () =>
    set((s) => {
      if (!s.playing || s.replayEvent) return s;
      const minute = Math.min(90, s.minute + s.speed * 0.5);
      const next: Partial<MatchState> = {
        minute,
        playing: minute < 90 ? s.playing : false,
      };
      if (AUTO_REPLAY) {
        const goal = EVENTS.find(
          (e) => e.type === "goal" && minute >= e.min && !s.seenGoals[e.min],
        );
        if (goal) {
          next.replayEvent = goal;
          next.seenGoals = { ...s.seenGoals, [goal.min]: true };
          next.camera = "keeper";
          next.slow = false;
        }
      }
      return { ...s, ...next };
    }),

  seek: (minute) =>
    set({ minute, seenGoals: goalsSeenUpTo(minute), replayEvent: null }),

  jumpToEvent: (ev) =>
    set({
      minute: ev.min,
      seenGoals: goalsSeenUpTo(ev.min),
      replayEvent: ev.type === "goal" ? ev : null,
      camera: "keeper",
      slow: false,
    }),

  closeReplay: () => set({ replayEvent: null, playing: true }),
  setCamera: (id) => set({ camera: id }),
  toggleSlow: () => set((s) => ({ slow: !s.slow })),
}));
