# Handoff: Layer 2 + Layer 3a frontend (P2 → P3/Thun)

Written 2026-07-10 by HK's session for Thun's Claude Code session.
Read alongside `docs/DESIGN.md` ("Feature design: Replay visuals" section —
the approved design this implements) and `docs/UI.md`.

## TL;DR

The **backend halves of Layer 2 (2D living pitch) and Layer 3a (360
diorama) are built, tested, and serving**. This document hands over the
**frontend halves**: replacing the `pitch-view.tsx` placeholder with the
SVG living pitch, and the replay overlay placeholder with the R3F
diorama. All data contracts below are live on replay-engine now.

## State of the repo

- `ui/src/lib/` gitignore bug: FIXED (root `.gitignore` had a Python
  template `lib/` rule silently ignoring it; `!/ui/src/lib/` exception
  added; the four lib files are committed and pushed).
- Backend work described here lives in: `app/derive.py`,
  `app/store.py`, `app/main.py`, `app/schemas.py`,
  `app/statsbomb_gateway.py`, `tests/test_flow.py`,
  `tests/test_moments.py`. HK is pushing these — `git pull` before
  starting, and pull again if HK reports the real-data moments check
  forced a fix (see Caveat below).
- Test status: full suite green on fixtures (flow: 9, moments: 8).
  Flow verified against the real demo match. Run:
  `cd replay-engine && python -m pytest -q`.

## Data contracts (all live)

### GET /matches/{id}/flow  → Layer 2

Array of compact rows, one per **located** regulation event, time-ordered:

```
[t, x, y, code, side, endX, endY]
 │  │  │   │     │      └─ null except pass/carry/shot
 │  │  │   │     └─ "h" | "a"
 │  │  │   └─ "pass"|"carry"|"shot"|"foul"|"corner"|"card"|"pressure"|"other"
 │  └──┴─ pitch coords, x∈[0,120] y∈[0,80]
 └─ match minute as float (e.g. 22.37), clamped to 90
```

~3–4k rows, ~100–150KB for the demo match. **Coordinates are already
normalized into one attacking frame** (home attacks x→120, away
attacks x→0; away-team raw coords were flipped server-side). Do NOT
flip anything client-side.

`[]` (empty array) = match derived before this feature (old volume
data). Keep the placeholder in that case. Re-adding the match
regenerates it. Unknown match id → 404.

### GET /matches/{id}/moments  → Layer 3a

Array with one entry per **shot goal that has a 360 freeze-frame**
(own goals never appear; matches without 360 coverage → `[]`):

```json
{
  "minute": 22.4,          // matches timeline "minute" for lookup
  "display_min": 23,
  "team": "h",             // scoring side
  "scorer": "Lionel Messi",
  "penalty": true,
  "xg": 0.78,              // may be null
  "shot_start": [108.6, 40.3],
  "shot_end": [120.0, 38.4, 0.7],   // x, y, z — z = height into goal (m-ish units)
  "players": [
    {"x": 100.1, "y": 35.2, "side": "h", "actor": false, "keeper": false},
    ...
  ]
}
```

- `players` = every player visible in the 360 frame (typically 15–20,
  NOT always 22 — render what's there).
- `actor` = the shooter. `keeper` flags both keepers. `side` is
  h/a in the same normalized frame as everything else.
- Same coordinate frame as flow; already flipped, don't touch.

### Timeline change: `has_3d`

`GET /matches/{id}/timeline` goal entries now carry `has_3d: bool`.
True ⇔ a moments entry exists with the same `minute`. Use it to gate
the "goal opens 3D replay" trigger and to badge timeline markers.
Cards/chances always have `has_3d: false` (schema default).

## What to build

### 1. Layer 2 — living pitch (do this first, ~4–6h)

Replace the striped placeholder in
`ui/src/components/viewer/pitch-view.tsx`. Per the approved design in
DESIGN.md:

- Load flow once in `use-match-data.ts` alongside snapshots/timeline
  (add `getFlow` to `replay-client.ts`, store it in match-store).
  Playback stays offline-after-load; everything is a pure function of
  the clock minute, same as `snapshotAt`.
- SVG pitch in the app's own language: ink markings on panel-cream
  (NOT broadcast green). Keep the existing momentum strip overlay.
- Ball: accent dot at the interpolated position between the two flow
  rows straddling the current minute. Rows are ~2s of match time
  apart so linear interpolation reads as continuous. rAF-interpolate
  between the 500ms clock ticks. **Snap, don't glide, across gaps**
  > ~5 s of match time (half-time, VAR, scrub jumps).
- Trails: last ~5 pass/carry rows before the clock as fading
  polylines (start→end), home red / away blue.
- Event flashes: brief glyph pulse at (x, y) when the clock crosses a
  foul/corner/card/shot row.
- Scale: viewBox 120×80 maps 1:1 to the coordinate space; y is NOT
  inverted (StatsBomb y grows toward the bottom of the standard pitch
  diagram — render y down, which matches SVG's default).
- Empty flow → keep today's placeholder unchanged.

### 2. Layer 3a — diorama (~6–9h)

Replace the replay-overlay placeholder with the R3F scene (three.js +
@react-three/fiber + drei, client-only dynamic import). Per DESIGN.md:

- Trigger: timeline goal click / auto-replay where `has_3d` is true;
  look up the moments entry by `minute`.
- Scene: pitch plane with markings, goal frames, low-poly
  team-colored figures at `players[].x/y` (canned poses by role:
  actor=shooter, keeper, other; oriented toward the ball), ball
  looping along a physical arc `shot_start → shot_end` (use the z!).
  Existing slow-mo chip scales arc speed; camera-preset chips fly
  OrbitControls to behind-keeper / aerial / touchline.
- `has_3d` false or no moments → today's placeholder + explicit
  "no 360 data for this match" note.

**⚠ One design request (cheap now, refactor later):** make the scene's
data loader accept an **array of frames**, where a freeze-frame is
just a 1-frame array — i.e. `frames: [{players: [...], ball: [x,y,z]}]`
internally, with the moments entry converted to a single frame at load.
The offline CV pipeline (P2's next task) will later produce multi-frame
track files in exactly that shape, and the goal upgrades from frozen to
animated with zero scene changes. This is the whole layering plan of
DESIGN.md's Layer 3b, minus its runtime service.

## Gotchas / house rules already learned

- Coordinates are pre-normalized server-side. If both teams' play
  looks like it attacks the same goal, you have a stale flow file —
  refetch — not a client bug to "fix" with a flip.
- `minute` in flow/moments/timeline is the 0-indexed float match
  clock; `display_min` is the human 1-indexed minute. Don't mix them.
- Old data volumes lack `{id}_flow.json`/`{id}_moments.json`; store
  serves `[]`, UI must degrade, never crash. Wipe volume or re-add to
  regenerate.
- statsbombpy quirks, licensing, and Docker rules: see the "StatsBomb
  gotchas" section of the earlier session handoff and DESIGN.md. No
  StatsBomb-derived files in git.
- Verification pattern per house convention: pytest for backend,
  `next build`, then puppeteer click-through screenshotting the pitch
  mid-move and the diorama mid-ball-flight (scripts in scratchpad).

## Caveat (resolved — but pull latest)

First real-data run surfaced a statsbombpy bug: `sb.frames(fmt=
"dataframe")` crashes with newer pandas (InvalidIndexError in its
concat). Fixed by bypassing it — `statsbomb_gateway.frames()` now
reads the raw open-data three-sixty JSON directly and flattens to the
`id / teammate / actor / keeper / location` shape the derivation (and
tests) expect. Verify after pulling: `/matches/3869685/moments` should
return 4 goals (Messi pen, Di María, Mbappé pen, Mbappé volley).

## Division of labor going forward

- Thun (this handoff): Layer 2 pitch → Layer 3a diorama → polish.
- HK: real-data moments verification + push; then offline CV track
  file for one rehearsed goal (video-only, drops into the 3a loader
  as a multi-frame array); available for track cleanup based on
  render feedback.
- Ping HK if `/flow` or `/moments` need contract changes — cheap to
  adjust server-side while he's in that code.
