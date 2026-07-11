"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowRow } from "@/lib/replay-client";
import { snapshotAt, useMatchStore } from "@/store/match-store";

// Layer 2: the living pitch. The ball follows the event stream (pre-
// normalized server-side — home attacks x→120, never flip here) and the
// trail is the ball's own recent path, so the two always connect. A
// rAF-driven smooth clock (shared by ball + trail) advances at the real
// playback rate between the store's 500ms ticks; scrubs snap.

const GAP_SNAP_MIN = 5 / 60; // don't glide/connect across >5s of match time
const TRAIL_WINDOW = 0.15; // minutes of path shown behind the ball (~9s)
const FLASH_WINDOW = 0.25; // minutes an event flash stays visible
const FLASH_STYLE: Record<string, { color: string; label: string }> = {
  shot: { color: "#c8492a", label: "shot" },
  foul: { color: "#d9a62e", label: "foul" },
  penalty: { color: "#c8492a", label: "penalty" },
  card: { color: "#d9a62e", label: "card" },
  corner: { color: "#6b675e", label: "corner" },
  throw_in: { color: "#6b675e", label: "throw-in" },
  goal_kick: { color: "#6b675e", label: "goal kick" },
};

/** index of last row with t <= minute */
function idxAt(flow: FlowRow[], minute: number): number {
  let lo = 0,
    hi = flow.length - 1,
    ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (flow[mid][0] <= minute) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** where row i sends the ball. In open play the truth is the NEXT
 * event's start — recorded end locations are phantoms on deflected or
 * intercepted balls (in clean play the two coincide anyway). Recorded
 * ends are only trusted when there is no next event to aim at. */
function rowTarget(flow: FlowRow[], i: number): { x: number; y: number } {
  const [, x, y, , , endX, endY] = flow[i];
  const next = flow[i + 1];
  if (next) return { x: next[1], y: next[2] };
  return { x: endX ?? x, y: endY ?? y };
}

const OUT_TRAVEL_MIN = 2 / 60; // a dead-ball event finishes its exit over ~2s
const ROLL_MIN = 1.5 / 60; // then the ball moves to the restart spot over ~1.5s

// where play resumes = the next ON-BALL action. Skipping "other"/
// "pressure" here matters: before a penalty StatsBomb logs the keeper
// setting up ON THE GOAL LINE as a located event — waiting there would
// park the ball inside the goal instead of on the spot.
const RESUME_CODES = new Set([
  "pass",
  "carry",
  "shot",
  "corner",
  "throw_in",
  "goal_kick",
]);

// persistent label shown at the waiting spot for the whole stoppage
const WAIT_LABELS: Record<string, string> = {
  throw_in: "throw-in",
  corner: "corner",
  goal_kick: "goal kick",
};

interface BallState {
  x: number;
  y: number;
  waiting: boolean;
  /** where the ball left play (the out event's end), while waiting */
  exit: { x: number; y: number; t: number; side: "h" | "a" } | null;
  /** code of the action play resumes with, while waiting */
  resumeCode: string | null;
  /** rolling back to a kickoff (goal / halftime reset) — no trail */
  reset: boolean;
  /** the stoppage is an actual out-of-play restart (throw-in/corner/
   * goal kick) — gates the "out" marker so fouls never show it */
  outOfPlay: boolean;
}

/** ball position at `minute`; during dead-ball gaps it finishes its
 * exit then waits where play resumes (throw-in point, corner arc,
 * goal-kick box, penalty spot — all of which are the next row's start) */
function ballAt(flow: FlowRow[], minute: number): BallState {
  const none = {
    waiting: false,
    exit: null,
    resumeCode: null,
    reset: false,
    outOfPlay: false,
  };
  const i = idxAt(flow, minute);
  if (i < 0) return { x: flow[0][1], y: flow[0][2], ...none };
  const [t, x, y, , side, endX, endY] = flow[i];
  const next = flow[i + 1];
  const tEnd = next ? next[0] : t;
  const span = tEnd - t;
  if (span <= 0) return { x, y, ...none };
  if (span > GAP_SNAP_MIN) {
    // where play resumes: next on-ball action (skip keeper/pressure rows)
    let w: FlowRow | null = null;
    if (next) {
      let k = i + 1;
      while (
        k < flow.length &&
        !RESUME_CODES.has(flow[k][3]) &&
        flow[k][0] - next[0] < 1.5
      ) {
        k++;
      }
      w = k < flow.length && RESUME_CODES.has(flow[k][3]) ? flow[k] : next;
    }
    // three phases: exit travel → roll to the restart spot → wait.
    // Events with no end location (clearances, blocks) get a synthetic
    // out-point: the restart type says WHICH boundary line the ball
    // crossed; the clearance location says WHERE along it. The roll
    // phase then carries the ball along the line to the restart spot.
    const synthExit =
      w && w[3] === "throw_in"
        ? { x, y: w[2] } // crossed the touchline level with the clearance
        : w && w[3] === "corner"
          ? { x: w[1], y } // crossed the byline at the clearance's height
          : w && w[3] === "goal_kick"
            ? { x: w[1] < 60 ? 0 : 120, y }
            : null;
    const exitEnd =
      endX !== null
        ? { x: endX, y: endY ?? y }
        : (synthExit ?? (w ? { x: w[1], y: w[2] } : { x, y }));
    const phase1End = t + OUT_TRAVEL_MIN;
    const phase2End = phase1End + ROLL_MIN;
    if (minute < phase1End) {
      const f = (minute - t) / OUT_TRAVEL_MIN;
      return {
        x: x + (exitEnd.x - x) * f,
        y: y + (exitEnd.y - y) * f,
        ...none,
      };
    }
    const exit = { ...exitEnd, t: phase1End, side };
    if (w) {
      // a roll to the exact center mark is a kickoff reset (goal or
      // halftime) — the movement shows, but it gets no trail
      const isReset = w[1] === 60 && w[2] === 40;
      const outOfPlay =
        w[3] === "throw_in" || w[3] === "corner" || w[3] === "goal_kick";
      if (minute < phase2End) {
        const f = (minute - phase1End) / ROLL_MIN;
        return {
          x: exitEnd.x + (w[1] - exitEnd.x) * f,
          y: exitEnd.y + (w[2] - exitEnd.y) * f,
          waiting: false,
          exit,
          resumeCode: null,
          reset: isReset,
          outOfPlay,
        };
      }
      return {
        x: w[1],
        y: w[2],
        waiting: true,
        exit,
        resumeCode: w[3],
        reset: isReset,
        outOfPlay,
      };
    }
    return { ...exitEnd, ...none };
  }
  const f = Math.min(1, (minute - t) / span);
  // Shots are two-leg even in open play: the ball genuinely travels to
  // its recorded end (the net or the save) before any rebound — aiming
  // straight at the next event would erase the flight at goal.
  if (flow[i][3] === "shot" && endX !== null) {
    const FLIGHT = 0.7; // share of the span spent flying at the goal
    if (f <= FLIGHT) {
      const g = f / FLIGHT;
      return {
        x: x + (endX - x) * g,
        y: y + ((endY ?? y) - y) * g,
        ...none,
      };
    }
    const g = (f - FLIGHT) / (1 - FLIGHT);
    const nx = next ? next[1] : endX;
    const ny = next ? next[2] : (endY ?? y);
    return {
      x: endX + (nx - endX) * g,
      y: (endY ?? y) + (ny - (endY ?? y)) * g,
      ...none,
    };
  }
  const tgt = rowTarget(flow, i);
  return { x: x + (tgt.x - x) * f, y: y + (tgt.y - y) * f, ...none };
}

interface PathPoint {
  x: number;
  y: number;
  t: number;
  side: "h" | "a";
  gapBefore: boolean;
}

/** the ball's actual recent path, ending exactly at its current position */
function ballPath(flow: FlowRow[], minute: number): PathPoint[] {
  const i = idxAt(flow, minute);
  if (i < 0) return [];
  const from = minute - TRAIL_WINDOW;
  let j = i;
  while (j > 0 && flow[j - 1][0] >= from) j--;
  const pts: PathPoint[] = [];
  for (let k = j; k < i; k++) {
    const [t, x, y, , side] = flow[k];
    const gapBefore = k > j && t - flow[k - 1][0] > GAP_SNAP_MIN;
    pts.push({ x, y, t, side, gapBefore });
  }
  const [t, x, y, , side] = flow[i];
  pts.push({ x, y, t, side, gapBefore: i > j && t - flow[i - 1][0] > GAP_SNAP_MIN });
  const ball = ballAt(flow, minute);
  if (ball.exit) {
    // the trail follows the ball to the spot it went out of play…
    pts.push({ ...ball.exit, gapBefore: false });
  }
  // …stays connected while it rolls to the restart spot, then breaks
  // once it's waiting there — no false line during the stoppage
  pts.push({
    x: ball.x,
    y: ball.y,
    t: minute,
    side,
    gapBefore: ball.waiting || ball.reset,
  });
  return pts;
}

/** rAF clock: advances at the playback rate between store ticks; snaps on scrubs */
function useSmoothMinute(): number {
  const minute = useMatchStore((s) => s.minute);
  const [smooth, setSmooth] = useState(minute);
  const ref = useRef({ smooth: minute, last: 0 });

  useEffect(() => {
    let raf = 0;
    const step = (now: number) => {
      const st = ref.current;
      // cap dt so a background-tab rAF pause can't produce a burst
      const dt = Math.min(st.last ? (now - st.last) / 1000 : 0, 0.1);
      st.last = now;
      const { minute: target, playing, speed } = useMatchStore.getState();
      const tick = (speed * 0.5) / 60; // match-minutes per store tick
      if (!playing) {
        st.smooth = target;
      } else {
        // aim mid-tick ahead, but cap the lead so high speeds (60×)
        // can't run visibly ahead of the store clock / skip the kickoff
        const err = target + Math.min(tick / 2, 0.02) - st.smooth;
        if (Math.abs(err) > 4 * tick + 0.05) {
          st.smooth = target; // scrub / jump — snap
        } else {
          // constant-velocity playback: always advance at the real match
          // rate; phase error only modulates the rate ±40%, so motion
          // never pulses, stalls, or reverses
          const mod = Math.max(-0.4, Math.min(0.4, err / (2 * tick)));
          st.smooth = Math.min(90, st.smooth + (speed / 60) * (1 + mod) * dt);
        }
      }
      setSmooth(st.smooth);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  // keep in range even if effect hasn't ticked yet
  return Math.abs(smooth - minute) > 2 ? minute : smooth;
}

const INK = "var(--color-ink)";

function Markings() {
  return (
    <g stroke={INK} strokeWidth="0.35" fill="none" opacity="0.45">
      <rect x="0.5" y="0.5" width="119" height="79" rx="1" />
      <line x1="60" y1="0.5" x2="60" y2="79.5" />
      <circle cx="60" cy="40" r="10" />
      <circle cx="60" cy="40" r="0.6" fill={INK} stroke="none" />
      <rect x="0.5" y="18" width="17.5" height="44" />
      <rect x="0.5" y="30" width="5.5" height="20" />
      <circle cx="12" cy="40" r="0.6" fill={INK} stroke="none" />
      <rect x="102" y="18" width="17.5" height="44" />
      <rect x="114" y="30" width="5.5" height="20" />
      <circle cx="108" cy="40" r="0.6" fill={INK} stroke="none" />
      <rect x="0.5" y="36" width="1.6" height="8" fill={INK} opacity="0.7" stroke="none" />
      <rect x="117.9" y="36" width="1.6" height="8" fill={INK} opacity="0.7" stroke="none" />
    </g>
  );
}

export function PitchView() {
  const activeMatch = useMatchStore((s) => s.activeMatch);
  const flow = useMatchStore((s) => s.matchFlow);
  const timeline = useMatchStore((s) => s.matchTimeline);
  const snap = useMatchStore((s) => snapshotAt(s.matchSnapshots, s.minute));
  const minute = useSmoothMinute();

  // Pressure events are located at the PRESSING DEFENDER, not the ball —
  // routing the ball through them makes it dart unnaturally. The ball's
  // path uses on-ball rows only; flashes still read the full flow.
  // Server timestamps are ~1s buckets, so quick exchanges share a t and
  // would hop instead of animate — give same-bucket rows synthetic
  // sub-second spacing (~0.4s) to keep motion continuous.
  const ballFlow = useMemo(() => {
    const rows = flow.filter(
      (r) => r[3] !== "pressure" && r[3] !== "keeper" && r[3] !== "card",
    );
    let prev = -Infinity;
    const spaced = rows.map((r) => {
      const t = Math.max(r[0], prev + 0.006);
      prev = t;
      return t === r[0] ? r : ([t, ...r.slice(1)] as FlowRow);
    });
    // kickoffs are recorded ~1 unit off the spot — snap the first touch
    // of the match / after any long gap to exactly (60, 40) so the ball
    // visibly starts ON the center mark
    for (let k = 0; k < spaced.length; k++) {
      const gapBefore =
        k === 0 || spaced[k][0] - spaced[k - 1][0] > GAP_SNAP_MIN;
      if (
        gapBefore &&
        Math.hypot(spaced[k][1] - 60, spaced[k][2] - 40) < 2.5
      ) {
        const c = [...spaced[k]] as FlowRow;
        c[1] = 60;
        c[2] = 40;
        spaced[k] = c;
      }
    }
    return spaced;
  }, [flow]);

  if (!snap || !activeMatch) return null;

  const homeAbbr = activeMatch.home_team.slice(0, 3).toUpperCase();
  const awayAbbr = activeMatch.away_team.slice(0, 3).toUpperCase();
  const hasFlow = flow.length > 0;

  const path = hasFlow ? ballPath(ballFlow, minute) : [];
  const ball = hasFlow ? ballAt(ballFlow, minute) : null;
  // label the stoppage: restarts by name; a wait ending in a shot from
  // either penalty spot is a penalty
  const waitLabel =
    ball?.waiting && ball.resumeCode
      ? (WAIT_LABELS[ball.resumeCode] ??
        (ball.resumeCode === "shot" &&
        Math.abs(ball.y - 40) < 2 &&
        (Math.abs(ball.x - 12) < 1.5 || Math.abs(ball.x - 108) < 1.5)
          ? "penalty"
          : null))
      : null;

  const flashes: FlowRow[] = [];
  if (hasFlow) {
    for (let i = idxAt(flow, minute); i >= 0; i--) {
      const row = flow[i];
      if (minute - row[0] > FLASH_WINDOW) break;
      if (row[3] in FLASH_STYLE) flashes.push(row);
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border-2 border-ink bg-panel">
      {hasFlow ? (
        <svg
          viewBox="0 0 120 80"
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full p-3"
        >
          <Markings />

          {/* trail = the ball's own path; last point IS the ball */}
          {path.slice(1).map((p, i) => {
            const prev = path[i];
            if (p.gapBefore) return null;
            const age = (minute - prev.t) / TRAIL_WINDOW;
            return (
              <line
                key={`${prev.t}-${i}`}
                x1={prev.x}
                y1={prev.y}
                x2={p.x}
                y2={p.y}
                // origin-colored: the segment belongs to the team that
                // played the ball along it — never retroactively
                // recolored when possession changes at the far end
                stroke={prev.side === "h" ? "#c8492a" : "#3a6ea5"}
                strokeWidth="0.5"
                strokeLinecap="round"
                opacity={Math.max(0.08, 0.6 - age * 0.55)}
              />
            );
          })}

          {flashes.map((row, i) => {
            const style = FLASH_STYLE[row[3]];
            const age = (minute - row[0]) / FLASH_WINDOW;
            return (
              <g key={`f-${row[0]}-${i}`} opacity={Math.max(0, 1 - age)}>
                <circle
                  cx={row[1]}
                  cy={row[2]}
                  r={1.4 + age * 1.6}
                  fill="none"
                  stroke={style.color}
                  strokeWidth="0.4"
                />
                <text
                  x={Math.min(Math.max(row[1], 6), 114)}
                  y={row[2] < 6 ? row[2] + 4.4 : row[2] - 2.2}
                  textAnchor="middle"
                  fontSize="2.6"
                  fontFamily="var(--font-mono)"
                  fill={style.color}
                >
                  {style.label}
                </text>
              </g>
            );
          })}

          {ball && (
            <circle
              cx={ball.x}
              cy={ball.y}
              r="1.1"
              fill="#c8492a"
              stroke="#2a2925"
              strokeWidth="0.25"
            />
          )}

          {/* "out" marker at the boundary crossing — through the roll and
              the first seconds of the wait, then fades; skipped when the
              restart is at the same spot (throw-ins) */}
          {ball?.exit &&
            (() => {
              const age = minute - ball.exit.t;
              const shotT = ball.exit.t - OUT_TRAVEL_MIN;
              const isGoal = timeline.some(
                (e) => e.type === "goal" && Math.abs(e.minute - shotT) < 0.06,
              );
              const window = isGoal ? 0.18 : 0.12;
              const nearRestart =
                Math.hypot(ball.exit.x - ball.x, ball.exit.y - ball.y) < 5;
              if (
                age < 0 ||
                age > window ||
                (!isGoal && !ball.outOfPlay) ||
                (!isGoal && ball.waiting && nearRestart)
              )
                return null;
              const o = age < 0.05 ? 1 : Math.max(0, 1 - (age - 0.05) / (window - 0.05));
              const color = isGoal ? "#c8492a" : "#6b675e";
              return (
                <g opacity={o}>
                  <circle
                    cx={ball.exit.x}
                    cy={ball.exit.y}
                    r={isGoal ? 2.4 : 1.8}
                    fill="none"
                    stroke={color}
                    strokeWidth={isGoal ? 0.5 : 0.35}
                  />
                  <text
                    x={Math.min(Math.max(ball.exit.x, 8), 112)}
                    y={ball.exit.y < 8 ? ball.exit.y + 5.2 : ball.exit.y - 3.2}
                    textAnchor="middle"
                    fontSize={isGoal ? 3.6 : 2.6}
                    fontWeight={isGoal ? "bold" : "normal"}
                    fontFamily="var(--font-mono)"
                    fill={color}
                  >
                    {isGoal ? "GOAL!" : "out"}
                  </text>
                </g>
              );
            })()}

          {/* persistent stoppage label at the waiting spot */}
          {ball && waitLabel && (
            <g className="animate-live-pulse">
              <circle
                cx={ball.x}
                cy={ball.y}
                r="2.4"
                fill="none"
                stroke="#6b675e"
                strokeWidth="0.35"
              />
              <text
                x={Math.min(Math.max(ball.x, 8), 112)}
                y={ball.y < 7 ? ball.y + 5 : ball.y - 3.2}
                textAnchor="middle"
                fontSize="2.8"
                fontFamily="var(--font-mono)"
                fill="#6b675e"
              >
                {waitLabel}
              </text>
            </g>
          )}
        </svg>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="font-mono text-[13px] tracking-[0.06em] text-muted">
            [ live pitch view ]
          </div>
          <div className="max-w-[380px] font-mono text-[11px] leading-[1.7] text-sand-2">
            No movement data for this match — it was added before the
            living-pitch feature. Delete and re-add it to regenerate.
          </div>
        </div>
      )}

      {/* momentum strip on pitch */}
      <div className="absolute right-4 bottom-3.5 left-4 flex flex-col gap-[5px]">
        <div className="flex justify-between font-mono text-[10px] tracking-[0.08em] text-muted">
          <span>MOMENTUM · {homeAbbr}</span>
          <span>{awayAbbr}</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded bg-track-2">
          <div
            className="bg-accent transition-[width] duration-800 ease-in-out"
            style={{ width: `${Math.round(snap.momentum * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
