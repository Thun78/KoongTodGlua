# Clip Upload Wizard Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a match is added in the wizard, an optional "4 · 3D Reconstruction" step accepts per-goal video clips, which replay-engine stores on the volume and tracks as queued reconstruction jobs (forwarded to a reconstruction service only if one is configured).

**Architecture:** Intake-only half of Layer 3b (spec: `docs/DESIGN.md` § "Feature design: Replay visuals"). replay-engine gains a clip store (files under `DATA_DIR/clips/`, statuses in `DATA_DIR/clips_status.json`), an upload endpoint keyed by goal minute, a status endpoint, and a `/health` capability flag that gates the wizard step. The wizard gains a post-fetch phase listing the new match's goals with drop zones and polled status chips. **reconstruction-svc is OUT of scope** — a teammate builds it; until then uploads sit `queued`.

**Tech Stack:** FastAPI + python-multipart (upload parsing), httpx (optional forward), Next.js wizard UI, pytest.

## Global Constraints

- **No `git commit`/`push`** — Thun commits manually; skip every commit step.
- Backend commands run with `/Users/thun/koongtodglua/.venv/bin/python`; existing 23 replay-engine tests must stay green; `cd ui && npx next build` must stay green.
- Clips live under `replay-engine/app/data/clips/` — already gitignored/dockerignored via the data dir; persisted by the `replay-data` volume.
- Wizard step is invisible unless `/health` reports `capabilities.reconstruction_upload: true` (env `RECONSTRUCTION_UPLOAD_ENABLED`, default **false**; compose sets it true for the team). Judged compose can flip it off if Layer 3b ends up unstaffed.
- Upload limits: extensions `.mp4/.mov/.webm` (or `video/*` content-type), max 100MB, streamed to disk in chunks (never fully buffered in memory).
- Goal identity in URLs = the timeline event's `minute` float as a string (e.g. `79.6`), validated against the match timeline with 0.01 tolerance.

---

### Task 1: Clip store module + tests

**Files:**
- Create: `replay-engine/app/clips.py`
- Test: `replay-engine/tests/test_clips.py`

**Interfaces (produces, used by Tasks 2 & 4):**
- `save_clip(data_dir: Path, match_id: int, minute: float, filename: str, stream) -> dict` — streams to `clips/{match_id}_{minute}{ext}`, writes status `queued`, returns the status entry. Raises `ValueError` on bad extension, `OversizeError` past `MAX_CLIP_BYTES` (100_000_000).
- `clip_statuses(data_dir: Path, match_id: int) -> dict[str, dict]` — `{ "79.6": {status, filename, uploaded_at, error?} }`.
- `set_status(data_dir: Path, match_id: int, minute: float, status: str, error: str | None = None) -> None`
- Statuses: `queued | reconstructing | ready | failed`.

- [ ] **Step 1: failing tests** — `replay-engine/tests/test_clips.py`:

```python
import io

import pytest

from app.clips import OversizeError, clip_statuses, save_clip, set_status


def test_save_clip_and_status(tmp_path):
    entry = save_clip(tmp_path, 111, 22.4, "goal.mp4", io.BytesIO(b"\x00" * 1024))
    assert entry["status"] == "queued"
    assert (tmp_path / "clips" / "111_22.4.mp4").read_bytes() == b"\x00" * 1024
    assert clip_statuses(tmp_path, 111)["22.4"]["status"] == "queued"


def test_bad_extension_rejected(tmp_path):
    with pytest.raises(ValueError):
        save_clip(tmp_path, 111, 22.4, "goal.exe", io.BytesIO(b"x"))
    assert clip_statuses(tmp_path, 111) == {}


def test_oversize_rejected_and_partial_removed(tmp_path, monkeypatch):
    monkeypatch.setattr("app.clips.MAX_CLIP_BYTES", 10)
    with pytest.raises(OversizeError):
        save_clip(tmp_path, 111, 22.4, "goal.mp4", io.BytesIO(b"\x00" * 100))
    assert not list((tmp_path / "clips").glob("*"))


def test_set_status(tmp_path):
    save_clip(tmp_path, 111, 22.4, "goal.mp4", io.BytesIO(b"x"))
    set_status(tmp_path, 111, 22.4, "failed", "couldn't calibrate pitch")
    st = clip_statuses(tmp_path, 111)["22.4"]
    assert st["status"] == "failed" and "calibrate" in st["error"]


def test_reupload_replaces(tmp_path):
    save_clip(tmp_path, 111, 22.4, "a.mp4", io.BytesIO(b"a"))
    set_status(tmp_path, 111, 22.4, "failed", "x")
    save_clip(tmp_path, 111, 22.4, "b.mp4", io.BytesIO(b"b"))
    assert clip_statuses(tmp_path, 111)["22.4"]["status"] == "queued"
```

- [ ] **Step 2: run, expect import failure** — `cd replay-engine && pytest tests/test_clips.py -q` → FAIL (`app.clips` missing).

- [ ] **Step 3: implement `replay-engine/app/clips.py`:**

```python
"""Clip intake for 3D reconstruction (Layer 3b). Stores uploaded goal
clips on the data volume and tracks per-goal job status in
clips_status.json. reconstruction-svc consumes clips later; until it
reports back, uploads stay 'queued'."""

import datetime
import json
import threading
from pathlib import Path

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm"}
MAX_CLIP_BYTES = 100_000_000
CHUNK = 1 << 20

_lock = threading.Lock()


class OversizeError(Exception):
    pass


def _status_path(data_dir: Path) -> Path:
    return data_dir / "clips_status.json"


def _load(data_dir: Path) -> dict:
    p = _status_path(data_dir)
    return json.loads(p.read_text()) if p.exists() else {}


def _write(data_dir: Path, all_statuses: dict) -> None:
    _status_path(data_dir).write_text(json.dumps(all_statuses, indent=1))


def clip_statuses(data_dir: Path, match_id: int) -> dict:
    return _load(data_dir).get(str(match_id), {})


def set_status(
    data_dir: Path, match_id: int, minute: float, status: str, error: str | None = None
) -> None:
    with _lock:
        allst = _load(data_dir)
        entry = allst.setdefault(str(match_id), {}).setdefault(str(minute), {})
        entry["status"] = status
        if error is None:
            entry.pop("error", None)
        else:
            entry["error"] = error
        _write(data_dir, allst)


def save_clip(data_dir: Path, match_id: int, minute: float, filename: str, stream) -> dict:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"unsupported file type {ext or '(none)'}; use mp4/mov/webm")
    clips_dir = data_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    dest = clips_dir / f"{match_id}_{minute}{ext}"
    written = 0
    try:
        with dest.open("wb") as f:
            while chunk := stream.read(CHUNK):
                written += len(chunk)
                if written > MAX_CLIP_BYTES:
                    raise OversizeError(f"clip exceeds {MAX_CLIP_BYTES // 1_000_000}MB limit")
                f.write(chunk)
    except OversizeError:
        dest.unlink(missing_ok=True)
        raise
    entry = {
        "status": "queued",
        "filename": filename,
        "uploaded_at": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
    }
    with _lock:
        allst = _load(data_dir)
        allst.setdefault(str(match_id), {})[str(minute)] = entry
        _write(data_dir, allst)
    return entry
```

- [ ] **Step 4: run** — `pytest tests/test_clips.py -q` → 5 passed; full `pytest -q` → 28 passed.

---

### Task 2: Upload + status endpoints, capability flag

**Files:**
- Modify: `replay-engine/app/main.py`
- Modify: `replay-engine/app/schemas.py` (Health gains `capabilities`)
- Modify: `replay-engine/pyproject.toml` (deps: `python-multipart`, `httpx`)
- Modify: `replay-engine/README.md` (endpoints list)
- Test: `replay-engine/tests/test_clip_endpoints.py`

**Interfaces (produces, used by Tasks 3 & 4):**
- `POST /matches/{match_id}/goals/{minute}/clip` — multipart field `file`; 200 → status entry JSON; 404 unknown match/goal; 413 oversize; 415 bad type.
- `GET /matches/{match_id}/clips` → `{ "79.6": {status, filename, uploaded_at, error?} }` (404 unknown match).
- `GET /health` → `{status, matches_loaded, capabilities: {reconstruction_upload: bool}}` from env `RECONSTRUCTION_UPLOAD_ENABLED` (truthy: `1/true/yes`, default false).
- If env `RECONSTRUCTION_SVC_URL` is set, a successful upload fire-and-forgets `httpx.post(f"{url}/reconstruct", ...)` in a daemon thread and sets status `reconstructing` on 2xx / `failed` otherwise. No callback handling here (teammate's scope).

- [ ] **Step 1: failing tests** — `replay-engine/tests/test_clip_endpoints.py`:

```python
import pandas as pd
from fastapi.testclient import TestClient

import app.main as main_mod
from app import derive
from app.main import app

client = TestClient(app)
MATCH = 3869685  # demo match; its timeline has goals at minutes 22.4, 35.6, 79.6, 80.6


def goal_minute():
    tl = client.get(f"/matches/{MATCH}/timeline").json()
    return next(e["minute"] for e in tl if e["type"] == "goal")


def test_health_capability_flag(monkeypatch):
    monkeypatch.setenv("RECONSTRUCTION_UPLOAD_ENABLED", "true")
    assert client.get("/health").json()["capabilities"]["reconstruction_upload"] is True
    monkeypatch.delenv("RECONSTRUCTION_UPLOAD_ENABLED")
    assert client.get("/health").json()["capabilities"]["reconstruction_upload"] is False


def test_upload_and_status(monkeypatch, tmp_path):
    monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
    m = goal_minute()
    r = client.post(
        f"/matches/{MATCH}/goals/{m}/clip",
        files={"file": ("goal.mp4", b"\x00" * 2048, "video/mp4")},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "queued"
    st = client.get(f"/matches/{MATCH}/clips").json()
    assert st[str(m)]["filename"] == "goal.mp4"


def test_upload_unknown_goal_404(monkeypatch, tmp_path):
    monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
    r = client.post(
        f"/matches/{MATCH}/goals/12.3/clip",
        files={"file": ("goal.mp4", b"x", "video/mp4")},
    )
    assert r.status_code == 404


def test_upload_unknown_match_404():
    r = client.post(
        "/matches/999/goals/1.0/clip", files={"file": ("g.mp4", b"x", "video/mp4")}
    )
    assert r.status_code == 404


def test_upload_bad_type_415(monkeypatch, tmp_path):
    monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
    r = client.post(
        f"/matches/{MATCH}/goals/{goal_minute()}/clip",
        files={"file": ("virus.exe", b"x", "application/octet-stream")},
    )
    assert r.status_code == 415


def test_upload_oversize_413(monkeypatch, tmp_path):
    monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
    monkeypatch.setattr("app.clips.MAX_CLIP_BYTES", 10)
    r = client.post(
        f"/matches/{MATCH}/goals/{goal_minute()}/clip",
        files={"file": ("goal.mp4", b"\x00" * 100, "video/mp4")},
    )
    assert r.status_code == 413


def test_clips_status_unknown_match_404():
    assert client.get("/matches/999/clips").status_code == 404
```

- [ ] **Step 2: run, expect failures** — 404s on the new routes / missing `capabilities` key.

- [ ] **Step 3: implement.** `schemas.py` — replace `Health` and add nothing else:

```python
class Capabilities(BaseModel):
    reconstruction_upload: bool


class Health(BaseModel):
    status: str
    matches_loaded: int
    capabilities: Capabilities
```

`main.py` — add imports `from fastapi import UploadFile`, `from app import clips`; update `health()`; add routes:

```python
def _reconstruction_upload_enabled() -> bool:
    return os.environ.get("RECONSTRUCTION_UPLOAD_ENABLED", "").lower() in ("1", "true", "yes")


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(
        status="ok",
        matches_loaded=len(store.matches),
        capabilities=Capabilities(reconstruction_upload=_reconstruction_upload_enabled()),
    )


def _goal_minutes(match_id: int) -> list[float] | None:
    tl = store.timeline(match_id)
    if tl is None:
        return None
    return [e["minute"] for e in tl if e["type"] == "goal"]


def _forward_to_reconstruction(match_id: int, minute: float) -> None:
    """Fire-and-forget handoff; reconstruction-svc (teammate's scope)
    takes it from here. Without RECONSTRUCTION_SVC_URL the clip simply
    stays queued."""
    url = os.environ.get("RECONSTRUCTION_SVC_URL")
    if not url:
        return

    def run() -> None:
        import httpx

        try:
            r = httpx.post(
                f"{url}/reconstruct",
                json={"match_id": match_id, "minute": minute},
                timeout=30,
            )
            clips.set_status(
                DATA_DIR, match_id, minute,
                "reconstructing" if r.is_success else "failed",
                None if r.is_success else f"svc returned {r.status_code}",
            )
        except Exception as e:
            clips.set_status(DATA_DIR, match_id, minute, "failed", f"svc unreachable: {e}")

    threading.Thread(target=run, daemon=True).start()


@app.post("/matches/{match_id}/goals/{minute}/clip")
def upload_clip(match_id: int, minute: float, file: UploadFile) -> dict:
    goals = _goal_minutes(match_id)
    if goals is None:
        raise HTTPException(status_code=404, detail=f"unknown match {match_id}")
    if not any(abs(minute - g) < 0.01 for g in goals):
        raise HTTPException(status_code=404, detail=f"no goal at minute {minute}")
    if not (file.filename or "").lower().endswith((".mp4", ".mov", ".webm")) and not (
        file.content_type or ""
    ).startswith("video/"):
        raise HTTPException(status_code=415, detail="upload an mp4/mov/webm video")
    try:
        entry = clips.save_clip(DATA_DIR, match_id, minute, file.filename or "clip.mp4", file.file)
    except clips.OversizeError as e:
        raise HTTPException(status_code=413, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e))
    _forward_to_reconstruction(match_id, minute)
    return entry


@app.get("/matches/{match_id}/clips")
def clips_status(match_id: int) -> dict:
    if match_id not in store.matches:
        raise HTTPException(status_code=404, detail=f"unknown match {match_id}")
    return clips.clip_statuses(DATA_DIR, match_id)
```

`pyproject.toml` dependencies gain `"python-multipart>=0.0.9"` and `"httpx>=0.27"` (move httpx out of dev). Install into the venv: `uv pip install -p /Users/thun/koongtodglua/.venv/bin/python python-multipart httpx`.

- [ ] **Step 4: run** — `pytest -q` → 35 passed. README: add the two endpoints + one line on the capability flag.

---

### Task 3: Docker + compose

**Files:**
- Modify: `build/Dockerfile.replay-engine` (runner pip: add `python-multipart httpx`)
- Modify: `docker-compose.yaml` (replay-engine environment: `RECONSTRUCTION_UPLOAD_ENABLED=true`; comment noting judged compose can flip to false and that `RECONSTRUCTION_SVC_URL` is set only when the GPU service exists)

- [ ] **Step 1:** runner stage install line becomes `pip install fastapi uvicorn statsbombpy pandas python-multipart httpx`.
- [ ] **Step 2:** compose env block:

```yaml
    environment:
      # gates wizard step "4 · 3D Reconstruction"; flip to false for the
      # judged submission if reconstruction-svc ends up unstaffed
      - RECONSTRUCTION_UPLOAD_ENABLED=true
      # set to the MI300X service URL when it exists, e.g. http://<host>:9000
      # - RECONSTRUCTION_SVC_URL=
```

- [ ] **Step 3:** `docker compose build replay-engine && docker compose up -d replay-engine` → `curl localhost:8000/health` shows `"reconstruction_upload":true`.

---

### Task 4: replay-client additions

**Files:**
- Modify: `ui/src/lib/replay-client.ts`

**Interfaces (produces, used by Task 5):**

```ts
export interface ClipStatus { status: "queued" | "reconstructing" | "ready" | "failed"; filename: string; uploaded_at: string; error?: string; }
getHealth(): Promise<{ status: string; matches_loaded: number; capabilities: { reconstruction_upload: boolean } }>
getClipStatuses(matchId: number): Promise<Record<string, ClipStatus>>
uploadClip(matchId: number, minute: number, file: File): Promise<ClipStatus>
```

- [ ] **Step 1: append to `replay-client.ts`:**

```ts
export interface Capabilities {
  reconstruction_upload: boolean;
}

export interface HealthInfo {
  status: string;
  matches_loaded: number;
  capabilities: Capabilities;
}

export interface ClipStatus {
  status: "queued" | "reconstructing" | "ready" | "failed";
  filename: string;
  uploaded_at: string;
  error?: string;
}

export const getHealth = () => get<HealthInfo>("/health");
export const getClipStatuses = (matchId: number) =>
  get<Record<string, ClipStatus>>(`/matches/${matchId}/clips`);

export async function uploadClip(
  matchId: number,
  minute: number,
  file: File,
): Promise<ClipStatus> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${BASE}/matches/${matchId}/goals/${minute}/clip`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d.detail)
      .catch(() => res.statusText);
    throw new Error(String(detail));
  }
  return res.json();
}
```

- [ ] **Step 2:** `cd ui && npx next build` → green.

---

### Task 5: Wizard step 4 UI

**Files:**
- Modify: `ui/src/components/add-match/add-match-screen.tsx`

**Behavior:** after `addMatch` succeeds, instead of `backHome()`: fetch `getHealth()` + `getTimeline(newMatchId)`. If `capabilities.reconstruction_upload` and the timeline has goals → phase `"clips"`; otherwise refresh catalog + `backHome()` (exactly current behavior). Phase `"clips"` renders:

- Heading `4 · 3D Reconstruction (optional)` + explainer copy: *"Attach a short clip of each goal (a few seconds, wide broadcast angle works best) — it's reconstructed into an animated 3D scene on our AMD GPU. Skip freely: goals still get 3D dioramas from positional data."*
- One row per goal: label from timeline (`{display_min}' · {label}`), an `<input type="file" accept="video/mp4,video/quicktime,video/webm">` styled as a drop-zone button, and a status chip.
- Status chip precedence: local `uploading…` while the POST is in flight → then the polled server value: `queued — reconstruction pending` / `reconstructing ~2min` / `ready ✓` / `failed: {error}` (re-selecting a file is the retry) / `no clip` when absent.
- Poll `getClipStatuses(matchId)` every 3s while the phase is mounted (clear interval on unmount).
- `[ Done ]` button (primary, always enabled) → `setCatalog(await getMatches())` + `backHome()`.

- [ ] **Step 1: implement.** State additions to the component:

```tsx
type Phase = "picking" | "submitting" | "clips" | "error";
const [addedMatch, setAddedMatch] = useState<MatchInfo | null>(null);
const [goals, setGoals] = useState<TimelineEvent[]>([]);
const [clipStatuses, setClipStatuses] = useState<Record<string, ClipStatus>>({});
const [uploading, setUploading] = useState<Record<string, boolean>>({});
const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
```

`submit(m)` success path becomes:

```tsx
const added = await addMatch(comp.competition_id, seasonId, m.match_id);
setCatalog(await getMatches());
const [health, timeline] = await Promise.all([
  getHealth().catch(() => null),
  getTimeline(added.match_id).catch(() => []),
]);
const goalEvents = timeline.filter((e) => e.type === "goal");
if (health?.capabilities.reconstruction_upload && goalEvents.length > 0) {
  setAddedMatch(added);
  setGoals(goalEvents);
  setPhase("clips");
} else {
  backHome();
}
```

Polling effect:

```tsx
useEffect(() => {
  if (phase !== "clips" || !addedMatch) return;
  const tick = () =>
    getClipStatuses(addedMatch.match_id).then(setClipStatuses).catch(() => {});
  tick();
  const t = setInterval(tick, 3000);
  return () => clearInterval(t);
}, [phase, addedMatch]);
```

Upload handler:

```tsx
const onClipPicked = async (ev: TimelineEvent, file: File) => {
  if (!addedMatch) return;
  const key = String(ev.minute);
  setUploading((u) => ({ ...u, [key]: true }));
  setUploadErrors((e) => ({ ...e, [key]: "" }));
  try {
    const st = await uploadClip(addedMatch.match_id, ev.minute, file);
    setClipStatuses((s) => ({ ...s, [key]: st }));
  } catch (e) {
    setUploadErrors((errs) => ({
      ...errs,
      [key]: e instanceof Error ? e.message : "upload failed",
    }));
  } finally {
    setUploading((u) => ({ ...u, [key]: false }));
  }
};
```

Render block (added as `phase === "clips"` branch, persona-screen styling; label uses a hidden file input):

```tsx
{phase === "clips" && addedMatch && (
  <div className="flex w-full max-w-[720px] animate-fade-up flex-col gap-7">
    <section className="flex flex-col gap-2.5">
      <div className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">
        4 · 3D Reconstruction <span className="text-muted normal-case">(optional)</span>
      </div>
      <p className="text-[13px] leading-normal text-muted-2">
        Attach a short clip of each goal (a few seconds, wide broadcast angle
        works best) — it&apos;s reconstructed into an animated 3D scene on our
        AMD GPU. Skip freely: goals still get 3D dioramas from positional data.
      </p>
      <div className="flex flex-col gap-1.5">
        {goals.map((g) => {
          const key = String(g.minute);
          const st = clipStatuses[key];
          const chip = uploading[key]
            ? "uploading…"
            : uploadErrors[key]
              ? `failed: ${uploadErrors[key]}`
              : st
                ? st.status === "queued"
                  ? "queued — reconstruction pending"
                  : st.status === "reconstructing"
                    ? "reconstructing ~2min"
                    : st.status === "ready"
                      ? "ready ✓"
                      : `failed: ${st.error ?? "error"}`
                : "no clip";
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-4 rounded-lg border-2 border-ink bg-card px-4 py-2.5"
            >
              <span className="font-condensed text-[17px] font-bold">
                {g.display_min}&apos; · {g.label}
              </span>
              <div className="flex items-center gap-3">
                <span
                  className={`font-mono text-[11px] ${
                    st?.status === "ready"
                      ? "text-accent"
                      : uploadErrors[key] || st?.status === "failed"
                        ? "text-accent"
                        : "text-muted"
                  }`}
                >
                  {chip}
                </span>
                <label className="cursor-pointer rounded-[5px] border-[1.5px] border-sand px-3 py-1.5 font-mono text-[12px] text-muted-2 transition-colors hover:border-accent hover:text-accent">
                  {st || uploading[key] ? "replace clip" : "⬆ add clip"}
                  <input
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onClipPicked(g, f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </section>
    <button
      type="button"
      onClick={backHome}
      className="cursor-pointer self-center rounded-lg border-2 border-ink bg-ink px-8 py-2.5 font-condensed text-[17px] font-bold tracking-[0.06em] text-cream uppercase transition-colors hover:bg-accent hover:border-accent"
    >
      Done
    </button>
  </div>
)}
```

Also: the `phase === "submitting"` guard currently renders the progress block for everything else — restructure the ternary so `clips` renders its branch (submitting block → `phase === "submitting" ? … : phase === "clips" ? … : picking-UI`). Imports gain `getHealth, getTimeline, getClipStatuses, uploadClip, type ClipStatus, type TimelineEvent, type MatchInfo`. The `← back` link stays visible only in `picking`/`error` phases (in `clips`, Done is the exit).

- [ ] **Step 2:** `npx next build` → green.

---

### Task 6: End-to-end verification

- [ ] **Step 1:** `pytest -q` (35 passed) and `npx next build` green.
- [ ] **Step 2:** `docker compose build && docker compose up -d` → `/health` shows the capability true.
- [ ] **Step 3:** create a tiny valid-enough clip: `mkfile -n 1m /tmp/goal.mp4` (content isn't validated — only extension/size). Browser e2e (puppeteer): wizard → add a match with goals (World Cup 2022 → any group match) → step 4 appears listing its goals → attach `/tmp/goal.mp4` to one → chip becomes `queued — reconstruction pending` → Done → home shows the card. Re-enter `curl localhost:8000/matches/{id}/clips` → entry present; `docker compose restart replay-engine` → status survives (volume).
- [ ] **Step 4:** negative checks via curl: `.exe` upload → 415; unknown goal minute → 404.

## Self-Review

- **Spec coverage:** step revealed post-fetch from real timeline ✓; per-goal rows + status chips ✓; fire-and-forget with Done always enabled ✓; capability gating via /health + env ✓; clip on volume, statuses persisted ✓; forward stub when `RECONSTRUCTION_SVC_URL` set ✓; reconstruction-svc itself explicitly out of scope ✓.
- **Placeholder scan:** clean — the forwarding contract is a scope boundary, not a TBD; every code step is written out.
- **Type consistency:** `ClipStatus` fields match `clips.py` output; status-key = `String(ev.minute)` matches backend `str(minute)`; `Capabilities` name shared between schema and client.
