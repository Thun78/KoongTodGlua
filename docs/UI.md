# AdaptiveMatch UI — Current Implementation

Reference for `ui/`. Companion to `docs/DESIGN.md` (the product pitch);
this doc covers how the code actually works today and what still gets
swapped as `model-svc` and the 3D pipeline come online. The
replay-engine integration described in earlier versions of this doc
**has been executed** (2026-07-10): stats are real now.

## Stack

Next.js 16 (App Router), TypeScript, Tailwind v4, Zustand. Single page
app; `src/app/page.tsx` switches between four screens based on one
store field (`home | persona | viewer | addMatch`), no router-based
navigation.

## Directory map

- `src/app/layout.tsx` — loads the three fonts (Barlow, Barlow Condensed,
  JetBrains Mono) via `next/font`, sets page metadata.
- `src/app/globals.css` — the design tokens (`@theme` block): every
  color, font family, and keyframe; none of it hardcoded in components.
- `src/app/page.tsx` — reads `screen` from the store and renders
  `HomeScreen` / `PersonaScreen` / `ViewerScreen` / `AddMatchScreen`.
- `src/lib/replay-client.ts` — typed fetchers for every replay-engine
  endpoint (`getMatches`, `getTimeline`, `getSnapshots`,
  `getCompetitions`, `getCatalogMatches`, `addMatch`) plus the shared
  types (`MatchInfo`, `Snapshot`, `TimelineEvent`, …). Base URL from
  `NEXT_PUBLIC_REPLAY_ENGINE_URL`, default `http://localhost:8000`.
- `src/lib/heuristics.ts` — the two client-side stand-ins for the Gemma
  jobs until model-svc lands: `predictFinal` (rate-extrapolation
  baseline for the Predicted Final panel) and `visibleStats` (persona
  curation rules). Both consume real snapshots.
- `src/lib/match-data.ts` — genuinely static fixtures only: `PERSONAS`,
  `CAMERAS`, `SPEEDS`, `AUTO_REPLAY`/`SHOW_RATIONALE` flags. (The old
  hardcoded `EVENTS` array is gone — timelines come from the engine.)
- `src/store/match-store.ts` — the state machine, one Zustand store:
  screen routing, persona (+ picker origin), the client-owned clock
  (`minute`, `playing`, `speed`), replay overlay state (`replayEvent`,
  `camera`, `slow`, `seenGoals`), and the replay-engine data
  (`catalog`, `catalogOffline`, `activeMatch`, `matchSnapshots`,
  `matchTimeline`). Also exports `snapshotAt(snapshots, minute)` — the
  half-minute lookup every stat component uses.
- `src/hooks/use-match-clock.ts` — 500ms `setInterval` → `store.tick()`
  while the viewer is mounted. The clock is client-owned by design.
- `src/hooks/use-match-data.ts` — loads the active match's snapshots +
  timeline (two bulk requests) into the store once per match entry.
- `src/components/home/` — catalog-driven match cards from
  `GET /matches` (falls back to a hardcoded demo entry with an
  "offline" caption if the engine is unreachable) + the dashed
  "+ add game" card. Each card has a two-click confirm ✕ that calls
  `DELETE /matches/{id}` (any match can be deleted, including the demo;
  re-add it via the wizard or reset the volume).
- `src/components/add-match/` — the Add Game wizard: cascading
  competition → season → match reveal, blocking progress state during
  the server-side fetch (~15–60s), inline error + retry.
- `src/components/persona|viewer|replay/` — persona picker; viewer
  (score bug, pitch placeholder, timeline, predictor panel, adaptive
  stats); fullscreen 3D replay overlay placeholder.
- `src/components/ui/` — `Chip` and `LiveBadge` primitives.

## What's real vs placeholder now

**Real (from replay-engine, derived from StatsBomb events):**
score, xG, shots, corners, cards, fouls, possession, pressing,
momentum, formations, foul-flurry flag, the timeline events (incl. own
goals), team names, and the match catalog. Playback works for any
added match, not just the demo.

**Placeholder (each is a documented seam):**
- **Predicted Final panel** — `heuristics.predictFinal` rate
  extrapolation; replaced by model-svc's `POST /predict` (Gemma).
- **Persona stat curation** — `heuristics.visibleStats` rules; replaced
  by model-svc's `POST /curate`.
- **Pitch view** — striped placeholder; becomes the 2D match render.
- **3D replay viewport** — striped placeholder; becomes the Three.js
  scene. The `tracks:` line shows `—`; track-file references must come
  from the backend timeline when the CV pipeline lands (the UI's old
  hardcoded track filenames were deleted with `EVENTS`).

## How a screen gets its numbers

Entering the viewer, `use-match-data` bulk-loads `matchSnapshots` (181
half-minute snapshots) and `matchTimeline` once, showing a splash until
ready. After that every component is synchronous: it reads `minute`
from the store and calls `snapshotAt(matchSnapshots, minute)` — an
array index, no per-tick network. The per-minute `GET /state` endpoint
still exists server-side for model-svc's later use.

## What changes as remaining services land

### `model-svc` (Gemma predict/curate)

- Replace `heuristics.predictFinal` calls in
  `components/viewer/predictor-panel.tsx` with `POST /predict`
  responses, and `heuristics.visibleStats` in
  `components/viewer/adaptive-stats.tsx` with `POST /curate` — polled
  every 30–60s and on notable events per DESIGN.md, with a stale/loading
  state (today's heuristics are instant, the model won't be).
- Add `NEXT_PUBLIC_MODEL_SVC_URL` and a `model-client.ts` mirroring
  `replay-client.ts`.
- Delete `heuristics.ts` once both panels are switched.

### 3D CV pipeline

- Replace the striped viewport block in
  `components/replay/replay-overlay.tsx` with a Three.js canvas fed by
  the event's track JSON.
- Backend: timeline events need a `track` field again (dropped in the
  StatsBomb-derived timeline); add it in `replay-engine/app/derive.py`
  or a lookup keyed by match/minute when track files exist.

### Persona persistence (noted, not needed yet)

- `persona` lives in the in-memory store; resets on refresh. Add
  Zustand `persist` middleware in `match-store.ts` if it ever needs to
  survive reloads.
