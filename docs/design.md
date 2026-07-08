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

```
StatsBomb Open Data (free, real event-level data)
        │
        ▼
Match Replay Engine ── streams events over WebSocket, "live" at adjustable speed
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

**Serving.** vLLM on ROCm inside the container, so the model is both trained and served on AMD.

**Fireworks credits ($50, code FW-LABLAB-9W9C).** Used for dev-time experimentation and prompt iteration against hosted Gemma 4 before our fine-tune is ready, so frontend and backend never wait on training.

**Fallback.** A rate-extrapolation baseline (current stats scaled to 90 minutes, plus league averages) sits behind the same API. If the fine-tune underperforms, the panel still works and the demo proceeds.

**Stretch.** GRPO on top of SFT with a reward for well-calibrated predictions, matching the AMD Academy GRPO course. Only if SFT lands early on day 2.

## Component 1b — Adaptive stat curation (same model, second job)

During open play the frontend asks the Gemma service every 30 to 60 seconds (and on notable events) which stats to display for the active persona. The model answers with a list drawn from a fixed stat vocabulary, and the frontend shows those panels and hides the rest.

**Training.** Mixed into the same SFT run as the predictor. Examples are generated with heuristic persona rules (each persona has a base stat set plus match-state triggers, for example fouls spiking surfaces card stats) refined by Fireworks-hosted Gemma 4. One to two thousand examples is plenty. This costs P1 an extra hour in the dataset script, not a second training pipeline.

**Fallback.** Prompt-only against the same served model, no fine-tuning needed. This is also the day 1 mode so the frontend can build against the real API shape immediately. If even that misbehaves, the heuristic persona rules run directly in the backend.

**Personas.** Three presets, passed to the model as part of the request. Casual Fan, Analyst, Bettor. Behaviour learning from clicks stays out of scope, future-work slide.

## Component 2 — 3D moment replica (the wow)

**Scope discipline.** Two or three pre-chosen goal clips, processed offline. The CV is real, the risk is not live.

**Pipeline per clip.**
1. Trim a few seconds of broadcast video around the moment. Keep clips short, broadcast footage is copyrighted and short excerpts for a hackathon demo are the defensible use.
2. YOLO (v8 or v11) detects players and ball per frame.
3. Jersey color clustering assigns team per detection.
4. A pretrained pitch keypoint model gives the homography from image to field coordinates.
5. Project detections to field XY, associate into tracks, smooth.
6. Export tracks as JSON.

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
| P4 | Replay engine, WebSocket backend, docker-compose, README, 5-min video, pitch deck | Demo script and rehearsal |

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
