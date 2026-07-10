# AdaptiveMatch AI

**A football match viewer that decides what deserves your attention.**
A fine-tuned Gemma 4 model watches the match state live and does two
jobs: it continuously predicts the final match stats, and it curates
which stats are worth showing *this* viewer *right now* (Casual Fan /
Analyst / Bettor personas). When a goal goes in, the screen erupts into
an orbitable 3D reconstruction of the moment built from real recorded
player positions.

Built for the AMD Developer Hackathon (Unicorn Track + Best Use of
Gemma 4) on StatsBomb Open Data.

> **TODO(reawya):** demo video link · GHCR image links (public,
> linux/amd64)

---

## Features

- **Predictor panel** — live Gemma 4 forecast of the final score,
  corners, cards, and possession, updating as the match plays. Watch
  the 2022 World Cup Final and watch the model get shocked by the
  France comeback in real time.
- **Adaptive stat curation** — the same model picks which stats each
  persona sees at each moment. A foul flurry surfaces card stats even
  for the Casual Fan; the Bettor always sees the running final-stat
  forecast.
- **2D living pitch** — schematic pitch animating the ball, pass/carry
  trails, and event flashes straight from event coordinates. No video
  anywhere in the product (and no AI claimed here — it's honest data
  visualization).
- **3D moment replay** — on a goal, an orbitable Three.js scene built
  from the StatsBomb 360 freeze-frame: every visible player at their
  real recorded position, the ball flying to the exact recorded spot
  in the goal (x, y, *and height*). Works on any of the ~426 matches
  with 360 coverage — including matches judges add themselves.
- **Add any match** — in-app wizard browses all of StatsBomb open
  data; adding a match fetches and derives it at runtime. Nothing is
  hardcoded to the demo match.
- **Offline CV reconstruction (dev-time)** — a pretrained
  YOLO + ByteTrack + homography pipeline (`reconstruction-svc/`) turns
  one continuous wide broadcast clip into animated player tracks that
  upgrade a goal's diorama from frozen to moving. Runs offline; only
  derived coordinates ship.

## Architecture

```
                        StatsBomb Open Data
                     (events · 360 freeze-frames)
                                │ fetched at build (demo match)
                                │ and at runtime (added matches)
                                ▼
   ┌───────────────── replay-engine (FastAPI :8000) ─────────────────┐
   │ derive.py: events → snapshots (181/match) · timeline · flow.json │
   │ (2D pitch) · moments.json (360 dioramas) — all precomputed,      │
   │ served from memory; playback is pure lookups, no live compute    │
   └────────────┬────────────────────────────────┬───────────────────┘
                │ REST                           │ match-state JSON
                ▼                                ▼
        ui (Next.js :3000)              model-svc (FastAPI)
   viewer · personas · 2D pitch      POST /predict · POST /curate
   Three.js 3D moment replay         MODEL_BACKEND = fireworks │ vllm │ heuristic
   add-match wizard                            │
                                               ▼
                                  Gemma 4 fine-tune, served by
                                  vLLM on ROCm (AMD MI300X)

   offline, dev-time only: reconstruction-svc/ (YOLO+ByteTrack+
   homography clip → track JSON; never in the judged containers)
```

One `docker-compose.yaml` runs everything. The client owns the match
clock; scrubbing/seeking is pure function-of-minute lookups, which is
what keeps every response well under the 30s judging budget.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 · TypeScript · Tailwind v4 · Zustand · Three.js via React Three Fiber + drei (3D replay) · SVG (2D pitch) |
| Backend | Python 3.13 · FastAPI · Pydantic v2 · statsbombpy + pandas (derivation) · pytest |
| AI — predictions & curation | Gemma 4 · SFT with Unsloth + LoRA + TRL · vLLM on ROCm (serving) · Fireworks AI (hosted dev/judge backend) |
| AI — computer vision | Ultralytics YOLOv8 (COCO pretrained, nothing trained) · ByteTrack · OpenCV (click-calibrated homography, LK optical-flow pan propagation, jersey k-means) · SciPy (track smoothing) |
| Data | StatsBomb Open Data (events + 360 freeze-frames) |
| Infra | AMD Instinct MI300X on AMD Developer Cloud · PyTorch ROCm · Docker Compose (linux/amd64 via buildx) · GHCR |

## Quickstart (judges)

```bash
docker compose up
# ui:            http://localhost:3000
# replay-engine: http://localhost:8000/health
```

The image bakes the demo match (2022 WC Final, Argentina–France). Add
any other StatsBomb open-data match via the "+ add game" card (the
~15–60s fetch happens once, then it persists in the data volume).

> **TODO(reawya):** confirm `MODEL_BACKEND` default + required env
> vars (`FIREWORKS_API_KEY` etc.) in `.env.example` once model-svc is
> merged.

## Dev setup

Backend:

```bash
cd replay-engine
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install fastapi uvicorn statsbombpy pandas pytest httpx python-multipart
python scripts/fetch_match.py     # fetch + derive the demo match
python -m pytest -q               # full suite (run from replay-engine/)
uvicorn app.main:app --port 8000
```

Frontend:

```bash
cd ui && npm install && npm run dev   # http://localhost:3000
```

CV pipeline (optional, offline): see `reconstruction-svc/README.md`.

## AMD usage

- **Gemma 4 SFT on an AMD Instinct MI300X** (AMD Developer Cloud).
  Training data is real: match-state snapshots at fixed minutes from
  hundreds of StatsBomb matches, labeled with the true final stats;
  curation examples generated from heuristic persona rules refined via
  Fireworks-hosted Gemma. Fine-tuned with Unsloth + LoRA + TRL on ROCm
  (`HSA_OVERRIDE_GFX_VERSION=9.4.2`).
  > **TODO(aki):** Gemma variant + size, dataset counts, training
  > wall-time, eval numbers (JSON validity rate, prediction sanity).
- **vLLM on ROCm serving** — the merged fine-tune is served with vLLM
  on the MI300X; the demo video records against this backend
  (`MODEL_BACKEND=vllm`). Judges running docker-compose without an AMD
  GPU get `MODEL_BACKEND=fireworks` (hosted Gemma 4) with a
  no-network `heuristic` fallback behind the same API.
- **CV inference on ROCm (stretch)** — the reconstruction pipeline's
  YOLO inference runs on the same MI300X via PyTorch ROCm wheels; see
  `reconstruction-svc/README.md`.
  > **TODO(HK):** MI300X vs CPU wall-time comparison once run.

## Judging-rules compliance

- **Container ready ≤60s** — all match data is precomputed at image
  build; startup is JSON loads into memory.
- **Every response ≤30s** — playback endpoints are list lookups.
  The one slow path (adding a new match, ~15–60s StatsBomb fetch) is
  explicit wizard UX, not a request handler the harness times.
- **No hardcoded answers** — predictions/curation run live against
  whatever match state is loaded; the add-match wizard works on all of
  StatsBomb open data, so unseen inputs are first-class.
- **Public linux/amd64 images** — built with
  `docker buildx build --platform linux/amd64` and published on GHCR.
  > **TODO(reawya/Thun):** image links after push.

## Data & licensing

StatsBomb Open Data, used under their public non-commercial agreement:
nothing StatsBomb-derived is committed to this repo or distributed
outside the built images' derived JSON; attribution logo on published
analysis. Broadcast clips used by the offline CV pipeline never leave
the dev machine and are never committed — only derived coordinate
tracks ship.

## Repo layout

```
replay-engine/       FastAPI: derivation + serving (snapshots, timeline,
                     flow, moments, catalog, add/delete match, clips)
ui/                  Next.js viewer (personas, panels, 2D pitch, 3D replay)
reconstruction-svc/  offline CV: clip → track JSON (YOLO, ByteTrack,
                     click-calibrated homography with pan propagation)
scripts/             dataset build + Gemma training scripts (MI300X)
build/               Dockerfiles (compose builds from repo root context)
docs/                DESIGN.md (baseline + appended decisions), UI.md,
                     HANDOFF-frontend-visuals.md
```

## Team

| Who | Owned |
|---|---|
| aki (P1) | StatsBomb dataset pipeline, Gemma 4 SFT on MI300X, vLLM/ROCm serving |
| HK (P2) | flow/moments derivation + endpoints, offline CV reconstruction pipeline |
| Thun (P3) | frontend: viewer, personas, panels, 2D pitch, 3D replay |
| reawya (P4) | replay engine core, model-svc integration, compose, submission |
