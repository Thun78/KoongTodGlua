# AdaptiveMatch AI — Design Baseline

AMD Developer Hackathon Act II, Track 3 (Unicorn Track) + Best Use of Gemma 4 bonus.
Team of 4, ~3 build days. Kickoff was July 6, 2026.

## One-liner

A football match viewer where a fine-tuned Gemma 4 model does two jobs during live play. It continuously predicts the final match stats, and it decides which live stats are worth showing to this particular viewer, hiding the rest. When a big moment happens (goal, red card) the viewer gets an orbitable 3D reconstruction of the scene built from real broadcast footage with computer vision.

## Why this wins here

The judging criteria for the Unicorn Track are creativity, originality, completeness, use of AMD platforms, and product potential. Submissions are not scored on accuracy. The organizers say to think startup pitch, not benchmark run.

- The 3D moment replay is the visual wow that judges remember.
- The Gemma 4 fine-tune is the AMD training story and qualifies us for the separate $6k Gemma 4 bonus pool with zero extra scope.
- Every risky piece has a working fallback, so the demo cannot die on stage.

## Product shape

One web app, the match viewer.

- **Predictor panel (always on).** Shows Gemma 4's live prediction of the final stats. Final score, total corners, total cards, possession split. Updates as the match progresses. The entertainment is watching the predictions converge, or get shocked by a comeback.
- **Adaptive stat display (always on).** The viewer picks a persona at the start (Casual Fan, Analyst, Bettor). During play, the same Gemma model decides which live stats are relevant to that persona right now and hides the rest. A casual fan sees score, time, and momentum. An analyst sees xG, pressing intensity, and formations. A bettor sees cards, corners, and the running final-stat predictions. The set changes with match state, so a flurry of fouls surfaces card stats even for the casual fan.
- **3D Moment Replay (event-triggered).** On a goal or red card, the screen switches to a 3D reconstruction of that moment. The viewer can orbit the camera and watch from any angle, for example from behind the goalkeeper.

The demo match is the 2022 World Cup final, Argentina vs France. Full event data is free in StatsBomb open data, and the 2-0 lead, late comeback to 3-3, and penalties make the prediction panel swing dramatically.

## Architecture

See `docs/UI.md` for how the frontend is actually implemented today
(Next.js/Zustand, what's real vs. placeholder math) and what to change
as the services below come online.

```
StatsBomb Open Data (free, real event-level data)
        │
        ▼
Match Replay Engine ── streams events over WebSocket, adjustable speed + seek/jump to moments
        │
        ├──► Gemma 4 service (SFT on MI300X, served via vLLM on ROCm) — two request types
        │        predict:  match-state JSON → {final_score, corners, cards, possession, rationale}
        │        curate:   match-state JSON + persona → {visible_stats: [...], rationale}
        │
        ├──► Moment trigger (goal / red card detected in event stream)
        │        │
        │        ▼
        │    3D track files (pre-extracted offline by the CV pipeline)
        │
        ▼
Web frontend ── pitch/match view, prediction panel, Three.js 3D replay on trigger
```

Offline CV pipeline (runs before the demo, not live):

```
Broadcast clip of the moment (a few seconds)
  → YOLO player + ball detection
  → team assignment via jersey color clustering
  → pitch homography (pretrained pitch-keypoint model, e.g. Roboflow sports)
  → per-frame XY field coordinates
  → smoothed tracks written to JSON, shipped with the app
```

All services run from one docker-compose file, which satisfies the containerization requirement.

## Component 1 — Stats predictor (the AMD fine-tune)

**Training data comes free, no synthetic generation needed.** For each historical match in StatsBomb open data, snapshot the match state at minutes 10, 20, 30, 40, 50, 60, 70, 80, 85. Each snapshot holds score, shots, xG, corners, cards, and possession so far, serialized as compact JSON. The label is that match's real final stats. Hundreds of matches yield thousands of real training pairs.

**Training.** Supervised fine-tune of a small Gemma 4 variant on one MI300X instance on AMD Developer Cloud, following AMD's AI Academy fine-tuning workflow. The $100 AMD cloud credits cover this. Expect hours, not days. Output format is strict JSON with a one-line rationale field.

**Serving and GPU budget.** The model service reads a `MODEL_BACKEND` env var with three values. `fireworks` calls hosted Gemma 4 (dev default, and what a judge running docker-compose gets, since they have no AMD GPU). `vllm` points at our fine-tune served with vLLM on ROCm on an AMD cloud instance. `heuristic` is the no-network fallback. The $100 credit is roughly 50 MI300X-hours at ~$2/hr, so the instance runs in short bursts only — training runs, final integration, demo recording — never left up overnight as a dev box. The README documents both backends, and the demo video records against `vllm` so the trained-and-served-on-AMD story is real.

**Fireworks credits ($50, code FW-LABLAB-9W9C).** Used for dev-time experimentation and prompt iteration against hosted Gemma 4 before our fine-tune is ready, so frontend and backend never wait on training.

**Extra time caveat.** The demo match went to extra time and penalties, but the training labels come from 90-minute matches. The model predicts regulation-time (90 minute) final stats by definition, and the demo narrative ends at 3-3 with penalties as a closing beat, not a predicted quantity.

**Fallback.** A rate-extrapolation baseline (current stats scaled to 90 minutes, plus league averages) sits behind the same API. If the fine-tune underperforms, the panel still works and the demo proceeds.

**Stretch.** GRPO on top of SFT with a reward for well-calibrated predictions, matching the AMD Academy GRPO course. Only if SFT lands early on day 2.

## Component 1b — Adaptive stat curation (same model, second job)

During open play the frontend asks the Gemma service every 30 to 60 seconds (and on notable events) which stats to display for the active persona. The model answers with a list drawn from a fixed stat vocabulary, and the frontend shows those panels and hides the rest.

**Training.** Mixed into the same SFT run as the predictor. Examples are generated with heuristic persona rules (each persona has a base stat set plus match-state triggers, for example fouls spiking surfaces card stats) refined by Fireworks-hosted Gemma 4. One to two thousand examples is plenty. This costs P1 an extra hour in the dataset script, not a second training pipeline.

**Fallback.** Prompt-only curation, no fine-tuning needed. On day 1 this runs against Fireworks-hosted Gemma (`MODEL_BACKEND=fireworks`), then switches to our vLLM endpoint once the fine-tune is served — same API shape either way, so the frontend builds against the real contract immediately. If even that misbehaves, the heuristic persona rules run directly in the backend.

**Personas.** Three presets, passed to the model as part of the request. Casual Fan, Analyst, Bettor. Behaviour learning from clicks stays out of scope, future-work slide.

**Stat vocabulary.** The fixed list the curator picks from is written down on day 1 because frontend panels, backend computation, and training data all depend on it. It includes two derived stats that someone must own computing from StatsBomb events. Momentum is the rolling xG differential over the last 10 minutes. Pressing intensity is pressure events per opposition possession. Formations come from StatsBomb lineup and tactics events. P4 owns the derived-stat computation in the replay backend.

## Component 2 — 3D moment replica (the wow)

**Scope discipline.** Two or three pre-chosen goal clips, processed offline. The CV is real, the risk is not live.

**Clip selection is a day 1 task with a hard criterion.** Broadcast coverage cuts to close-ups and crowd shots the instant a goal goes in, and the homography needs one continuous wide-angle shot. Candidate moments are chosen by footage first, drama second: a continuous wide shot covering the buildup, or it does not qualify. Messi's second (the long team move) likely qualifies; Mbappé's volley probably cuts too fast. P2 verifies actual footage before committing, day 1.

**Pipeline per clip.**
1. Trim a few seconds of broadcast video around the moment. Keep clips short, broadcast footage is copyrighted and short excerpts for a hackathon demo are the defensible use.
2. YOLO (v8 or v11) detects players and ball per frame.
3. Jersey color clustering assigns team per detection.
4. A pretrained pitch keypoint model gives the homography from image to field coordinates.
5. Project detections to field XY, associate into tracks, smooth.
6. Export tracks as JSON.

**Why one camera is enough.** We never do true multi-view 3D reconstruction. The pitch is a flat plane with exactly known dimensions and standardized markings, so detecting a few landmarks (line intersections, box corners, center circle) yields a per-frame homography that maps any image point on the grass to exact field coordinates. Each player's ground contact point (bottom-center of the YOLO box) projects through it to an accurate field XY, where we place a generic 3D player model oriented along its velocity. The scene is a stylized video-game-style replica, not a volumetric capture. Known single-camera limits and their workarounds:

1. Airborne ball projects wrongly (homography only holds on the grass). Track the ball at ground contacts only and synthesize a physically plausible arc between them.
2. Off-screen players. Animate visible players only, or fill the rest from the StatsBomb 360 freeze-frame for that event, which records all 22 positions.
3. Occlusion gaps in tracks. Smoothing and interpolation over the few-second clip.
4. Camera pans and zooms. Re-estimate the homography every frame with the pitch-keypoint model, which is built for this.

**Rendering.** Three.js stadium scene. Low-poly player capsules colored by team, a ball, orbit controls. The replay animates the tracked positions. Polish items in order of value are camera presets (behind the goal, aerial, touchline), slow motion, then player numbers.

**Fallbacks, in order.**
1. If homography fights us, drop to StatsBomb 360 freeze-frames, which already contain player XY positions at key events. The 3D scene renders the same way.
2. If tracking is too noisy for animation, render the freeze-frame as a static orbitable 3D diorama of the goal moment. Still a wow.

**Stretch.** Run YOLO inference live on the AMD GPU during the demo, which strengthens the AMD usage story further.

## Cuts (future-work slide, not in scope)

Behaviour learning from viewer interactions, more than three personas, XR rendering, player-level predictions such as assist probability and substitution timing. The original thesis, the right information at the right moment, is now delivered by the stat curation feature during play and full 3D immersion at the peak moments.

## Team split

| Who | Owns | Fallback duty |
|---|---|---|
| P1 | StatsBomb data pipeline, curation dataset, Gemma 4 SFT on AMD cloud, vLLM serving | Rate-extrapolation baseline, prompt-only curation |
| P2 | CV pipeline, YOLO, homography, tracking, track JSON export | StatsBomb 360 freeze-frame path |
| P3 | Frontend, match viewer, prediction panel, persona toggle + adaptive stat panels, Three.js 3D replay | Static diorama mode |
| P4 | Replay engine (with seek/jump, required for video recording), derived stats, WebSocket backend, docker-compose, README, 5-min video, pitch deck | Demo script and rehearsal |

P4 pairs with P1 on the dataset scripts on day 1, since P1 holds four critical-path deliverables while P4's heavy work (video, README) lands on day 3.

## Timeline

**Day 1.** End-to-end skeleton working with fallbacks only. Replay engine streams the World Cup final, baseline predictor fills the panel, prompt-only curation drives the persona stat panels, one hand-made or freeze-frame 3D scene renders. Training data pipeline (prediction + curation examples) done, fine-tune launched overnight if possible.

**Day 2.** Fine-tuned Gemma 4 replaces the baseline behind the same API for both request types. CV pipeline produces tracks for 2 or 3 real goal clips. Frontend polish, camera presets, transitions.

**Day 3.** Feature freeze at noon. Afternoon is the 5-minute video, README with architecture and AMD usage section, full docker-compose test from a clean machine, submission upload with margin before the deadline.

Anchor these days to the real deadline once confirmed (open question below).

## Submission checklist

- [ ] Working project, containerized (single docker-compose up)
- [ ] GitHub repo with README covering architecture, setup instructions, and AMD usage (Gemma 4 SFT on MI300X, vLLM on ROCm, optional YOLO on AMD GPU)
- [ ] 5-minute demo video covering pain points, target consumers, workflow, and tech stack
- [ ] Gemma 4 usage clearly documented for the bonus prize
- [ ] Future-work slide with the full AdaptiveMatch vision (overlays, personas, XR)

## Demo video script (5 minutes)

1. **Pain point (30s).** Sports apps drown fans in dashboards. Watching stats means missing the match.
2. **Live demo (3min).** The World Cup final replays in Casual Fan mode, a clean screen with just score, time, and momentum while Gemma quietly forecasts the final stats. Flip the persona toggle to Bettor and the visible stats change instantly, cards and corners appear. Messi scores, the screen erupts into the orbitable 3D goal, camera swings behind the keeper. Back to play, the predictions have swung toward Argentina. France's comeback makes the panel swing again, proof the model reacts to the match, not the script.
3. **Tech stack (1min).** Gemma 4 fine-tuned on an AMD Instinct MI300X, served with vLLM on ROCm, YOLO-based scene reconstruction, all containerized.
4. **Vision (30s).** Future-work slide, the full adaptive viewing platform.

## Open questions

1. Exact submission deadline (date, time, timezone). Needed to anchor the timeline.
2. Which 2 or 3 goal clips to reconstruct. Messi's second (the team-move goal) and Mbappé's volley are the natural picks if footage quality allows.
3. Gemma 4 variant size for the fine-tune. Decide day 1 based on what fits comfortably in MI300X memory with the AMD recipe defaults, smallest variant that produces reliable JSON wins.

---

## Feature design: Add Game flow + real playback (2026-07-10)

Approved design for replacing the home screen's "[ match slot ]"
placeholders with an in-web Add Game wizard, and wiring the UI to
replay-engine so added matches (and the demo match) actually play real
StatsBomb-derived stats. Supersedes the "further matches populated by
backend" placeholder note above.

### Scope decisions (settled with Thun)

- **Full playback.** Adding a match means you can watch it: home list,
  score bug, stats, momentum, and timeline all come from replay-engine
  for whichever match is selected. The UI↔replay-engine integration is
  part of this feature.
- **Predictor panel** becomes the heuristic baseline from the fallback
  plan (current real stats rate-extrapolated to 90', floored at the
  current score, gentle priors before ~10', generic rationale line).
  This is the seam model-svc later replaces. The demo-scripted 5-phase
  narrative in ui/src/lib/simulation.ts is deleted with the rest of the
  fake math.
- **Wait in wizard.** After picking a match the form shows a progress
  state for the ~15–60s server-side fetch+derive, then lands home with
  the new card ready. No background-job machinery.
- **No database.** Persistence is a named Docker volume on
  replay-engine's data dir. Docker seeds the volume from the baked
  demo-match data on first run; added matches survive restarts. (A
  selections DB + refetch-on-restart was considered and rejected: the
  DB needs its own volume anyway, so it adds a container without
  removing the volume.)

### Backend (replay-engine grows a write side)

- Refactor derivation out of scripts/fetch_match.py into app/derive.py
  (pure: meta + events → snapshots/timeline/catalog entry; writer).
  CLI script and the Docker build fetch stage become thin wrappers —
  build behavior unchanged, demo match still baked at image build.
  StatsBomb calls go behind app/statsbomb_gateway.py so tests can fake
  them without network.
- New endpoints:
  - GET /catalog/competitions — competitions grouped with seasons
    (sb.competitions(), cached in memory after first call)
  - GET /catalog/matches?competition_id=&season_id= — pickable matches
    (match_id, date, stage, teams, score), cached per pair
  - POST /matches {competition_id, season_id, match_id} — fetch →
    derive → write to data dir → hot-add to in-memory store under a
    lock; runs in FastAPI's worker threadpool. Idempotent (re-add
    returns existing entry). Unknown IDs → 404; StatsBomb unreachable
    → 502 with a message the wizard displays.
  - GET /matches/{id}/snapshots — all 181 snapshots in one response
    (playback loads bulk; per-minute /state remains for model-svc)
- Runtime image gains statsbombpy+pandas (only the *add* path needs
  network; watching stays offline-safe). CORS gains POST. compose:
  named volume on /svc/app/data.

### UI

- src/lib/replay-client.ts — typed fetchers for all endpoints; base
  URL from NEXT_PUBLIC_REPLAY_ENGINE_URL (default localhost:8000).
- Home renders one dark match card per catalog entry (GET /matches)
  plus one dashed "+ Add game" card reusing the slot aesthetic. Engine
  unreachable → fall back to the hardcoded demo entry with a subtle
  "replay engine offline" note; home never dies.
- Add Game wizard: new screen in the existing state machine
  (home | persona | viewer | addMatch), persona-screen styling.
  Cascading reveal: competition select → season chips → match list
  (date · stage · teams · score). Clicking a match POSTs, shows
  progress, returns home on success; inline error + retry on failure
  without losing selections.
- Viewer: entering loads that match's snapshots + timeline once (one
  loading splash), then all components stay synchronous via array
  lookups — simulation.ts is deleted; team names come from the catalog
  entry. Timeline markers/auto-replay use the real timeline (home team
  red, away blue, cards gold, chances muted). 3D overlay "tracks:"
  shows — for matches without pre-extracted track files.
- match-store gains activeMatch; persona curation stays client-side,
  fed real values (foul_flurry from snapshots).

### Testing

- pytest: catalog endpoints + POST /matches against a faked gateway
  with canned frames (covering own-goal and missing-column cases),
  idempotent re-add, 404/502. Existing 8 tests keep passing.
- Frontend: next build + manual click-through add→watch; demo match
  remains the rehearsed path.
- docs/UI.md's "what changes when replay-engine lands" section gets
  updated as this work executes it.

### Out of scope

model-svc (predict/curate via Gemma), WebSocket streaming, 3D track
files for non-demo matches, persisting persona across reloads.
(Deleting matches was originally out of scope but shipped 2026-07-10:
`DELETE /matches/{id}` + a two-click confirm ✕ on each home card.)

---

## AI strategy decisions (2026-07-10)

Settled after the judging rules were published. The rules that drove
these calls: container ready within 60s, every response under 30s,
no hardcoded/cached answers — evaluation uses unseen variants, and
images must be publicly pullable linux/amd64.

### Decision 1 — model-svc is the AI centerpiece and gets built first

The predictor panel currently runs a client-side heuristic and persona
curation is client-side rules; for an AI hackathon that is the gap.
Priority order for remaining AI effort:

1. **model-svc** (FastAPI): `POST /predict` and `POST /curate`,
   `MODEL_BACKEND=fireworks` first (uses the $50 Fireworks credits),
   wired into the predictor panel and adaptive-stats panels, replacing
   `ui/src/lib/heuristics.ts`. A real model reasoning over unseen match
   states is exactly what the no-hardcoding rule tests.
2. **Fine-tune story**: SFT on MI300X + `vllm` backend behind the same
   API — the AMD platform points and the Gemma bonus pool.
3. **Gemma garnish in 3D moments**: one-line tactical read of each
   goal's freeze-frame overlaid in the 3D scene. Cheap, real inference,
   on-theme.
4. `heuristic` backend remains the no-network fallback per the original
   fallback philosophy.

### Decision 2 — 3D moments are 360-freeze-frame dioramas, no footage

The 3D moment replay is built from StatsBomb 360 freeze-frames (real
recorded player positions per event) rendered as an orbitable low-poly
scene. Verified availability: 426 fully-covered matches across 12
tournaments (all of WC 2022 incl. the demo final, both Euros, Women's
WC 2023, Bundesliga 23/24, La Liga 20/21, Ligue 1, MLS subset), so the
feature generalizes to matches judges add themselves — no per-match
footage, nothing shipped but JSON coordinates, no licensing exposure.
Matches without 360 data degrade gracefully to the current placeholder
with an explicit "no 360 data for this match" note.

Honest framing for judges: the diorama is **data visualization, not
AI** — player limbs/poses are canned assets picked by role (shooter,
keeper, others), not inferred. The AI claims stay attached to Gemma
(predict/curate/tactical captions) and, in the offline path only, to
the YOLO/homography CV pipeline.

### Decision 3 — no video anywhere in the shipped product

- Full-match video in the repo/image: rejected (1–3GB per match breaks
  the 60s pull/startup budget, cannot generalize to user-added matches,
  and broadcast footage is copyrighted).
- Pulling video from YouTube at runtime: rejected (pirated uploads get
  taken down mid-judging, ToS, region blocks, and broadcast-to-event
  clock sync is genuinely hard).
- The live pitch view becomes a **2D schematic render from event
  coordinates** (every StatsBomb event carries pitch x,y): SVG pitch,
  ball marker interpolated along event locations, pass/carry trails,
  event flashes. Events arrive every ~2s of match time, so plain
  interpolation looks continuous — no AI needed and none claimed.
- Footage-tracked animated buildup for 2–3 rehearsed demo goals stays
  an optional offline dev-time polish (YOLO pipeline on a teammate's
  laptop; only coordinate tracks would ship). Show it in the 5-minute
  video, never at runtime.

### Deliberately on the future-work slide (not built)

- **Runtime "upload a goal clip → 3D scene"**: originally rejected here,
  **superseded later the same day** — see "Feature design: Replay
  visuals" below. The objections (30s rule, CPU inference, image bloat)
  are resolved by running inference on the team's MI300X instead of the
  judged container, and by placing upload inside the wizard's slow
  path; arbitrary-footage fragility is absorbed by the 360-diorama
  fallback. Remains conditional on a dedicated owner (~20h) — without
  one it returns to this slide.
- **Learned player-trajectory imputation** for a continuous 22-player
  2D view: genuine ML (multi-agent trajectory prediction) but 360
  frames lack cross-frame identities and only show visible players;
  solving association + imputation is days of work for a smoother
  minimap judges won't score.

---

## Feature design: Replay visuals — 2D living pitch, 360 dioramas, clip reconstruction (2026-07-10)

Settled with Thun at T-31h to deadline (~80 person-hours across 4 people).
Three pieces, strictly layered so each ships independently and failure of
a later layer never degrades an earlier one.

### Shared foundation — two new derived files

`replay-engine/app/derive.py` grows two exports, produced in all three
existing pipeline paths (dev fetch, Docker build stage, runtime
POST /matches):

- `{id}_flow.json` — one compact row per located regulation event:
  `[t, x, y, eventCode, side, endX, endY]` (passes/carries/shots carry
  end locations). ~100–150KB per match. Served at
  `GET /matches/{id}/flow`.
- `{id}_moments.json` — one entry per goal: the 360 freeze-frame (all
  visible players' [x,y] + teammate/keeper/actor flags) plus the shot's
  `location` and 3D `end_location` (x, y, height into the goal). Only
  when the match has 360 data; timeline goals carry `has_3d`. Served at
  `GET /matches/{id}/moments`.

**Coordinate normalization (the silent-bug guard):** StatsBomb event and
360 coordinates are attacking-team-relative (each team recorded as
attacking left→right). Derivation normalizes to one frame — home team
events unchanged, away team events flipped (120−x, 80−y) — with a unit
test on a canned fixture. Both files are bulk-loaded once by
`use-match-data` alongside snapshots/timeline; playback stays
offline-after-load, scrub/seek stays a pure function of minute.

### Layer 2 — 2D living pitch (replaces the striped placeholder)

Schematic pitch in the app's own design language (ink markings on
panel-cream, not broadcast green). Ball = accent dot interpolated
between consecutive event locations (~2s of match time apart, so linear
interpolation reads as continuous); rAF interpolation between clock
ticks; snap instead of glide across large gaps. Trails: last ~5 events
as fading polylines, home red / away blue. Event flashes: brief glyph
pulse at the real location when the clock crosses fouls/corners/cards/
shots. Momentum strip stays. No AI claimed, none used.
Estimate: ~2–3h backend, ~4–6h frontend.

### Layer 3a — 360 diorama (the guaranteed 3D moment)

On goal trigger (auto-replay or timeline click), the replay overlay
renders a real 3D scene via three.js / React Three Fiber + drei
(client-only dynamic import): pitch plane with markings, goal frames,
low-poly team-colored figures at true 360 positions (canned poses
selected by role — shooter/keeper/other — oriented toward the ball;
honest framing: data visualization, not AI). One data-driven motion:
the ball flies from the shooter's foot along a physical arc to the
exact recorded 3D spot in the goal, looping; the existing Slow-mo chip
scales its speed and the camera-preset chips (behind keeper / aerial /
touchline) fly the OrbitControls camera to fixed vantage points.
Matches without 360 keep today's placeholder plus an explicit "no 360
data for this match" note. Generalizes to all ~426 360-covered matches,
i.e. judges' unseen inputs. Estimate: ~3–4h backend, ~6–9h frontend.

### Layer 3b — clip-upload reconstruction (optional upgrade, wizard-only)

**UX:** new wizard step revealed only after the match fetch completes
(goal list requires the derived timeline): "4 · 3D Reconstruction
(optional)". One row per goal with a drop zone (mp4/mov, ~100MB cap)
and a status chip (no clip · uploading · reconstructing ~2min ·
ready ✓ · failed + reason). Fire-and-forget: Done is always enabled,
jobs continue server-side, the moment upgrades from frozen diorama to
animated when its track lands. Wizard-only by decision — no upload
affordance in the replay overlay (existing catalog matches will be
deleted). The step is invisible unless replay-engine reports a
reconstruction service configured (capabilities flag on /health driven
by RECONSTRUCTION_SVC_URL), so judges without the GPU box never see it.

**reconstruction-svc** (name chosen over "cv-svc" for clarity): FastAPI
on the team's MI300X instance, PyTorch on ROCm (HSA_OVERRIDE_GFX_VERSION
=9.4.2). Pipeline per clip, all pretrained — nothing is trained:
ffmpeg/OpenCV decode → YOLO (Ultralytics) player+ball detection →
ByteTrack identity tracking → jersey-color k-means team assignment →
pitch-keypoint model + cv2.findHomography per frame (image→pitch
coords via ground-contact points) → SciPy smoothing → fusion with
StatsBomb (360 frame fills off-camera players; event location/
end_location anchors the ball arc) → track JSON out (few KB). The clip
is discarded after processing; only coordinates persist. This is the
second AMD-usage story: CV inference served from MI300X via ROCm.

**Plumbing:** browser → POST /matches/{id}/goals/{event}/clip
(multipart) on replay-engine → streamed to reconstruction-svc → job id
→ UI polls → on success replay-engine writes {match}_tracks_{event}.json
to the data volume and marks the moment animated. Failures (bad angle,
homography defeat, service down) mark that goal failed with reason; the
diorama stays. Judged container never runs GPU work; 60s-startup and
30s-response rules are untouched.

**Staffing/risk decision:** Layer 3b requires one dedicated owner for
their full remaining budget (~20h) plus the MI300X kept running through
judging (~$2/hr from remaining credits); it dies to the diorama
fallback whenever the instance is off. Layers 2 and 3a ship first and
do not depend on it. If no owner exists, 3b moves to the future-work
slide with a pipeline demo in the video only.

### Verification

Backend pytest: coordinate-flip fixture, flow ordering, moments only
for goals, graceful no-360, existing suite green. next build; fresh
docker compose from a clean volume; puppeteer click-through
screenshotting the living pitch mid-move and the diorama mid-ball-
flight on a wizard-added (unseen) match. Reconstruction path verified
manually against one known-good wide-angle clip before demo recording.
