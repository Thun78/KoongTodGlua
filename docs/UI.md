# AdaptiveMatch UI — Current Implementation

Reference for `ui/`. Companion to `docs/DESIGN.md` (the product pitch);
this doc covers how the code actually works today and what to rip out as
`replay-engine`, `model-svc`, and the 3D pipeline come online.

## Stack

Next.js 16 (App Router), TypeScript, Tailwind v4, Zustand. Single page
app; `src/app/page.tsx` switches between three screens based on one
store field, there is no router-based navigation between them.

## Directory map

- `src/app/layout.tsx` — loads the three fonts (Barlow, Barlow Condensed,
  JetBrains Mono) via `next/font`, sets page metadata.
- `src/app/globals.css` — the design tokens (`@theme` block): every
  color, font family, and keyframe from the original design file, none
  of it hardcoded again in components.
- `src/app/page.tsx` — reads `screen` from the store and renders
  `HomeScreen` / `PersonaScreen` / `ViewerScreen`.
- `src/store/match-store.ts` — the entire state machine, one Zustand
  store: `screen`, `persona`, `minute`, `playing`, `speed`,
  `replayEvent`, `camera`, `slow`, `seenGoals`, plus every action that
  mutates them (`enterMatch`, `pickPersona`, `tick`, `seek`,
  `jumpToEvent`, `closeReplay`, …).
- `src/hooks/use-match-clock.ts` — `setInterval` that calls
  `store.tick()` every 500ms while `ViewerScreen` is mounted. This is
  the entire "clock" today: a local timer in the browser tab, nothing
  server-side drives it.
- `src/lib/match-data.ts` — static fixtures: the 7 hardcoded timeline
  `EVENTS` (with `track` filenames for goals), `PERSONAS`, `CAMERAS`,
  `SPEEDS`, and the `AUTO_REPLAY` / `SHOW_RATIONALE` flags.
- `src/lib/simulation.ts` — **placeholder math only**. `computeStats(minute)`,
  `computePrediction(minute)`, `computeVisibleStats(persona, stats, minute)`
  are pure functions of a minute number. No fetch, no backend, no
  randomness — same input always gives the same output.
- `src/components/home|persona|viewer|replay/` — the screens and the
  pieces inside the viewer (score bug, pitch view, timeline, predictor
  panel, adaptive stats, 3D replay overlay).
- `src/components/ui/` — two small shared primitives, `Chip` (toggle
  buttons for speed/camera/slow-mo) and `LiveBadge` (the pulsing LIVE
  pill).

## What's real vs simulated

**Real, genuine UI state, nothing to swap out later:**
screen routing, play/pause/speed, seek/scrub, the 3D-replay
open/close/camera/slow-mo controls, and the goal de-dup logic
(`seenGoals`, so scrubbing back over an already-seen goal doesn't
retrigger the overlay).

**Fake, exists only so the screens have something to render:**
every stat number, the predicted score/corners/cards/possession, and
the list of which stats are visible per persona. All of it is formulas
in `simulation.ts` keyed only off `minute` — there is no match data,
model, or network call behind any number on screen today.

## How a screen gets its numbers today

Every component that shows a stat (`score-bug.tsx`, `pitch-view.tsx`,
`predictor-panel.tsx`, `adaptive-stats.tsx`) reads `minute` and/or
`persona` from the store and calls the relevant `simulation.ts`
function directly in the component body, on every render. There is no
loading state, no error state, and no request of any kind anywhere in
the app yet — everything resolves synchronously and instantly.

---

## What changes as each backend service lands

### `replay-engine` (streams real match events + derived stats)

- **Delete** `computeStats()` and the `LiveStats` type from
  `simulation.ts` — real values come from the engine instead.
- **Add** a client (e.g. `src/lib/replay-client.ts`) that
  `score-bug.tsx` and `pitch-view.tsx` call instead of `computeStats`.
- **Decide and likely keep as-is**: `use-match-clock.ts`'s local timer.
  Per the sync discussion, the recommended shape for a hackathon demo
  is client-owned clock (what exists today) that periodically asks
  `replay-engine` "what are the real values as of minute X", rather
  than the engine broadcasting an authoritative clock to every viewer.
  Revisit only if multi-viewer shared-live-sync becomes an actual
  requirement.
- **Replace** `match-data.ts`'s hardcoded `EVENTS` array with whatever
  the engine returns for the match. Keep the hardcoded array as the
  `heuristic`-style fallback fixture, matching DESIGN.md's fallback
  philosophy, don't delete it outright.
- **Replace** `pitch-view.tsx`'s striped "[ live pitch view ]"
  placeholder with the real 2D render, still driven by the same
  minute value.

### `model-svc` (Gemma predict/curate API)

- **Delete** `computePrediction()` and `computeVisibleStats()` from
  `simulation.ts`.
- **Add** `src/lib/model-client.ts` calling `POST /predict` and
  `POST /curate` (contract in `model-svc/app/schemas.py`), invoked from
  `predictor-panel.tsx` and `adaptive-stats.tsx`. Per DESIGN.md, poll
  every 30–60s and on notable events, not on every render.
- **Add** a brief loading/stale state to those two components for the
  gap before the first response arrives — doesn't exist today because
  local math is instant.
- **Add** an env var (e.g. `NEXT_PUBLIC_MODEL_SVC_URL`) to `ui` and to
  `docker-compose.yaml` so the frontend can reach the service by name
  inside the compose network.

### 3D CV pipeline (goal/red-card reconstructions)

- **Delete** the "[ three.js 3d reconstruction viewport ]" placeholder
  text block in `replay-overlay.tsx`.
- **Add** an actual Three.js canvas in that div, fed by the track JSON
  named in `replayEvent.track`. The plumbing for this already exists —
  `match-data.ts` → `jumpToEvent` → `store.replayEvent.track` — only the
  renderer itself is missing.

### Docker / compose

- `docker-compose.yaml` currently defines only `ui`. Add `replay-engine`
  and `model-svc` as their own services (`build/Dockerfile.replay-engine`,
  `build/Dockerfile.model-svc`, following the same pattern as
  `build/Dockerfile.ui`), and wire their internal service URLs into
  `ui`'s `environment` block.

### Persona persistence (not needed yet, noted for later)

- `persona` currently lives only in the in-memory Zustand store — it
  resets on refresh and is independent per browser tab. If a future
  requirement wants it to survive a reload, add Zustand's `persist`
  middleware (localStorage) in `match-store.ts`. Deliberately not done
  now since nothing in the current design calls for it.
