# AdaptiveMatch AI — Session Handoff (2026-07-10)

Context transfer for a fresh Claude Code session. Read this alongside
`docs/DESIGN.md` (product baseline + all appended feature designs/decisions)
and `docs/UI.md` (frontend implementation reference). Working directory:
`/Users/thun/koongtodglua` (git repo, macOS, Apple Silicon).

## The project in one paragraph

AMD Developer Hackathon submission ("Unicorn Track" + Gemma 4 bonus): a
football match viewer where a fine-tuned Gemma 4 predicts final match stats
live and curates which stats each persona (Casual Fan / Analyst / Bettor)
sees, with 3D reconstructions of goals. Data: StatsBomb open data. Team of
4. **Deadline: ~31h from 2026-07-10 morning; ~80 person-hours total left.**

## Hard judging rules (drive many decisions)

- Container ready ≤60s; every response ≤30s; publicly pullable
  **linux/amd64** images (Thun's Mac is arm64 — must `docker buildx build
  --platform linux/amd64 --push`; GHCR packages default PRIVATE, must be
  made public). No hardcoded/cached answers — judges use unseen inputs.

## Architecture (current, all working)

```
docker-compose.yaml (repo root; Dockerfiles live in build/ — Thun's rule)
├── ui            (Next.js 16 + Tailwind v4 + Zustand, port 3000, container_name UI)
│                  mirrors caipe-ui conventions (github.com/cnoe-io/ai-platform-engineering)
└── replay-engine (FastAPI, port 8000, named volume replay-data:/svc/app/data)
```

### replay-engine (`replay-engine/`)
- `app/derive.py` — pure derivation: StatsBomb events → 181 half-minute
  snapshots (score/xG/shots/corners/cards/fouls/possession/pressing/
  momentum/formations/foul_flurry + the exact keys `scripts/build_dataset.py`
  trains on) + timeline (goals incl. own goals, cards, big chances).
- `app/statsbomb_gateway.py` — seam over statsbombpy; tests monkeypatch it.
- `app/store.py` — in-memory store loaded from `app/data/` JSONs.
- `app/clips.py` — clip intake (see Layer 3b below).
- `app/main.py` — endpoints: `/health` (has `capabilities.reconstruction_upload`),
  `GET /matches`, `GET /matches/{id}/timeline|snapshots|state?minute=`,
  `POST /matches` (add by {competition_id, season_id, match_id}; fetches+derives
  at runtime, ~15-60s, idempotent, 404/502), `DELETE /matches/{id}`,
  `GET /catalog/competitions`, `GET /catalog/matches?...`,
  `POST /matches/{id}/goals/{minute}/clip`, `GET /matches/{id}/clips`.
- Docker: fetch build-stage bakes the demo match (2022 WC final, id 3869685);
  runtime has statsbombpy+pandas+python-multipart+httpx for the add path only.
- Tests: `35 passed` — run `cd replay-engine && /Users/thun/koongtodglua/.venv/bin/python -m pytest -q`.
  Canned fixtures in `tests/conftest.py` cover own-goal + missing-column cases.

### ui (`ui/`)
- Single-page state machine (`home | persona | viewer | addMatch`) in
  `src/store/match-store.ts` (Zustand). Client owns the match clock
  (500ms ticks; `speed` = match-min/sec).
- `src/lib/replay-client.ts` — typed client for every endpoint above.
- `src/lib/heuristics.ts` — TEMPORARY predictor (rate extrapolation) +
  persona curation rules; the seam model-svc replaces.
- Home = catalog cards (offline fallback to hardcoded demo entry) + two-click
  delete ✕ + "[ + add game ]" card. Wizard = cascading competition → season →
  match → (fetch ~30s) → step "4 · 3D Reconstruction (optional)" with
  per-goal clip upload rows + polled status chips + Done.
- Viewer = real playback: bulk-loads snapshots+timeline once
  (`use-match-data.ts`), then everything is `snapshotAt(snapshots, minute)`
  lookups. Score bug (score centered, clock pinned in bottom padding),
  striped pitch placeholder (Layer 2 will replace), timeline scrubber with
  real event markers, heuristic predictor panel, persona-curated stats,
  replay overlay placeholder (Layer 3a will replace).

## StatsBomb gotchas already learned (don't relearn)

- IDs: `sb.competitions()` → (competition_id, season_id) → `sb.matches()` →
  match_id → `sb.events(match_id)`. Demo: 43/106/3869685 (ARG-FRA 2-2 reg).
- Minutes are 0-indexed (Messi pen = minute 22 → display 23').
- Own goals are separate event types (`Own Goal For/Against`, linked via
  `related_events`) — NOT shots; missing them under-reports scores.
- statsbombpy omits columns absent from a match (e.g. `bad_behaviour_card`)
  — derive.py backfills expected columns with pd.NA.
- Event/360 coordinates are attacking-team-relative → must flip away-team
  coords (120−x, 80−y) for a coherent pitch (NOT yet implemented — needed
  by Layers 2/3).
- 360 freeze-frames (`sb.frames(match_id)`): full coverage for 426 matches /
  12 tournaments (WC2022 all 64, both Euros, WWC2023, Bundesliga 23/24,
  La Liga 20/21, Ligue 1, some MLS). CL open data = finals only (1/season).
- License (read, in scratchpad): free for research; NO commercial use, NO
  redistribution of raw data (nothing StatsBomb-derived is committed or
  baked outside images; `replay-engine/app/data/` is git+docker-ignored),
  logo attribution required on published analysis.

## Thun's working conventions (follow these)

- **Never `git commit`/push — Thun commits manually.** Nothing committed all session.
- Dockerfiles go in `build/` at repo root (`build/Dockerfile.ui`, etc.),
  compose uses `context: . / dockerfile: build/Dockerfile.X`.
- Design work is appended to `docs/DESIGN.md` (repo convention), not
  scattered files. Plans in `docs/superpowers/plans/`.
- Workflow: brainstorm (questions one at a time) → design section in
  DESIGN.md → plan file → inline execution with tests + real browser
  verification (puppeteer-core + system Chrome; scripts in the session
  scratchpad — pattern: launch headless Chrome at localhost:3000, click
  through, screenshot, assert on innerText).
- `.gitignore` has a `!/build/` exception (the Python template's `build/`
  rule was silently ignoring the Dockerfiles — fixed).

## What is NOT built yet (priority order agreed with Thun)

1. **model-svc** — THE judged AI, still missing (tasks #6/#7). FastAPI,
   `POST /predict` + `POST /curate`, `MODEL_BACKEND` env: `fireworks`
   (hosted Gemma 4, $50 credits, code FW-LABLAB-9W9C, dev default) /
   `vllm` (own fine-tune on MI300X) / `heuristic` (fallback). Replaces
   `ui/src/lib/heuristics.ts` usage in predictor-panel + adaptive-stats.
   Snapshot JSON is already a superset of the training `match_state`.
2. **Fine-tune** — `scripts/build_dataset.py` (NEEDS FIXING: corners proxy
   = all passes, possession hardcoded 52/48 — rewrite to reuse
   `app/derive.py` so train format == serve format), `scripts/train.py`
   (Unsloth + LoRA + TRL on MI300X, HSA_OVERRIDE_GFX_VERSION=9.4.2),
   merged export → vLLM. AMD story + Gemma bonus.
3. **Layer 2: 2D living pitch** — designed (DESIGN.md "Replay visuals"):
   `{id}_flow.json` from event locations, SVG pitch in paper aesthetic,
   interpolated ball + trails + event flashes. ~6-9h.
4. **Layer 3a: 360 diorama** — designed: `{id}_moments.json` (goal
   freeze-frames + shot 3D end_location), React Three Fiber scene, canned-
   pose figures, data-driven ball flight, camera presets on existing chips,
   graceful no-360. ~9-13h. Honest framing: data viz, NOT AI.
5. **Layer 3b: reconstruction-svc** — clip intake half is DONE (wizard
   step 4 + storage + statuses + forward-when-`RECONSTRUCTION_SVC_URL`).
   The GPU service itself (YOLO/ByteTrack/homography on MI300X via ROCm,
   all pretrained) needs a dedicated ~20h owner or moves to future-work;
   staffing question was never answered by Thun.

## Current runtime state

- `docker compose up -d` runs both; catalog holds Thun's own picks
  (Spurs-Liverpool CL final 22912, Barca-Villarreal 3773593, + Portugal-Ghana
  3857298 with a dummy queued clip from e2e). Thun plans to wipe the catalog
  before submission (`docker volume rm koongtodglua_replay-data` resets to
  baked demo).
- Env on replay-engine: `RECONSTRUCTION_UPLOAD_ENABLED=true` (flip false for
  judged compose if 3b unstaffed); `RECONSTRUCTION_SVC_URL` unset.
- venv: `.venv` (Python 3.13, uv) has statsbombpy, pandas, fastapi, uvicorn,
  pytest, httpx, python-multipart. UI deps installed in `ui/node_modules`.

## Known open items / warts

- `POST /matches` can exceed 30s (judge-rule risk if their harness times it;
  wizard UX accepts it).
- Predictor heuristic is aggressive early (1-0 at 18' → "5-0"); possession
  reads oddly in minute 0-2 (tiny sample). Both die when model-svc lands.
- Clip content isn't validated (extension/size only) — reconstruction-svc's
  decode is the real validation.
- `.env.example` is empty; images not yet pushed to any registry (amd64
  buildx + GHCR-public steps documented in conversation, not executed).
- Old plan files in `docs/superpowers/plans/` are complete/executed.
