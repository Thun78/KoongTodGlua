"""AdaptiveMatch replay engine.

Serves precomputed StatsBomb-derived match state, and adds new matches
at runtime (POST /matches — the only path that needs network). The
client owns the match clock and asks for state as-of a minute; nothing
here advances time. Data source: StatsBomb Open Data (statsbomb.com) —
used under their public data agreement, attribution required on
published analysis.
"""

import os
import threading

from fastapi import FastAPI, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app import clips, derive, statsbomb_gateway
from app.schemas import (
    AddMatchRequest,
    Capabilities,
    CatalogMatch,
    CompetitionSeasons,
    Health,
    MatchInfo,
    MatchStateSnapshot,
    TimelineEvent,
)
from app.store import DATA_DIR, MatchStore

app = FastAPI(title="AdaptiveMatch Replay Engine", version="0.2.0")
app.state.catalog_cache = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(","),
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

store = MatchStore()
_add_lock = threading.Lock()


def _reconstruction_upload_enabled() -> bool:
    return os.environ.get("RECONSTRUCTION_UPLOAD_ENABLED", "").lower() in (
        "1",
        "true",
        "yes",
    )


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(
        status="ok",
        matches_loaded=len(store.matches),
        capabilities=Capabilities(
            reconstruction_upload=_reconstruction_upload_enabled()
        ),
    )


@app.get("/matches", response_model=list[MatchInfo])
def matches() -> list[dict]:
    return store.catalog()


@app.get("/matches/{match_id}/timeline", response_model=list[TimelineEvent])
def timeline(match_id: int) -> list[dict]:
    tl = store.timeline(match_id)
    if tl is None:
        raise HTTPException(status_code=404, detail=f"unknown match {match_id}")
    return tl


@app.get("/matches/{match_id}/snapshots", response_model=list[MatchStateSnapshot])
def snapshots(match_id: int) -> list[dict]:
    m = store.matches.get(match_id)
    if m is None:
        raise HTTPException(status_code=404, detail=f"unknown match {match_id}")
    return m["snapshots"]


@app.get("/matches/{match_id}/state", response_model=MatchStateSnapshot)
def state(
    match_id: int,
    minute: float = Query(..., ge=0, le=90, description="match minute 0–90"),
) -> dict:
    snap = store.state(match_id, minute)
    if snap is None:
        raise HTTPException(status_code=404, detail=f"unknown match {match_id}")
    return snap


@app.post("/matches", response_model=MatchInfo)
def add_match(req: AddMatchRequest) -> dict:
    # sync def → FastAPI runs this in the worker threadpool, so the
    # 15–60s fetch doesn't block other requests
    with _add_lock:
        existing = store.matches.get(req.match_id)
        if existing:
            return existing["info"]
        try:
            data = derive.fetch_and_derive(req.competition_id, req.season_id, req.match_id)
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"StatsBomb fetch failed: {e}")
        derive.write_match(data, DATA_DIR)
        store.add_match(data["entry"], data["snapshots"], data["timeline"])
        return data["entry"]


@app.delete("/matches/{match_id}", status_code=204)
def delete_match(match_id: int) -> None:
    with _add_lock:
        if match_id not in store.matches:
            raise HTTPException(status_code=404, detail=f"unknown match {match_id}")
        store.matches.pop(match_id)
        derive.delete_match(match_id, DATA_DIR)


def _goal_minutes(match_id: int) -> list[float] | None:
    tl = store.timeline(match_id)
    if tl is None:
        return None
    return [e["minute"] for e in tl if e["type"] == "goal"]


def _forward_to_reconstruction(match_id: int, minute: float) -> None:
    """Fire-and-forget handoff; reconstruction-svc (separate service on
    the MI300X) takes it from here. Without RECONSTRUCTION_SVC_URL the
    clip simply stays queued."""
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
                DATA_DIR,
                match_id,
                minute,
                "reconstructing" if r.is_success else "failed",
                None if r.is_success else f"svc returned {r.status_code}",
            )
        except Exception as e:
            clips.set_status(
                DATA_DIR, match_id, minute, "failed", f"svc unreachable: {e}"
            )

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
        entry = clips.save_clip(
            DATA_DIR, match_id, minute, file.filename or "clip.mp4", file.file
        )
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


@app.get("/catalog/competitions", response_model=list[CompetitionSeasons])
def catalog_competitions() -> list[dict]:
    cache = app.state.catalog_cache
    if "competitions" not in cache:
        df = statsbomb_gateway.competitions()
        grouped: dict[int, dict] = {}
        for _, row in df.iterrows():
            comp = grouped.setdefault(
                int(row["competition_id"]),
                {
                    "competition_id": int(row["competition_id"]),
                    "competition_name": str(row["competition_name"]),
                    "seasons": [],
                },
            )
            comp["seasons"].append(
                {"season_id": int(row["season_id"]), "season_name": str(row["season_name"])}
            )
        cache["competitions"] = sorted(grouped.values(), key=lambda c: c["competition_name"])
    return cache["competitions"]


@app.get("/catalog/matches", response_model=list[CatalogMatch])
def catalog_matches(competition_id: int, season_id: int) -> list[dict]:
    cache = app.state.catalog_cache
    key = f"matches:{competition_id}:{season_id}"
    if key not in cache:
        df = statsbomb_gateway.matches(competition_id, season_id)
        cache[key] = [
            {
                "match_id": int(r["match_id"]),
                "date": str(r["match_date"]),
                "stage": str(r["competition_stage"]),
                "home_team": str(r["home_team"]),
                "away_team": str(r["away_team"]),
                "home_score": int(r["home_score"]),
                "away_score": int(r["away_score"]),
            }
            for _, r in df.sort_values("match_date").iterrows()
        ]
    return cache[key]
