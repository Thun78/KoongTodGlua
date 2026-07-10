from fastapi.testclient import TestClient

import app.main as main_mod
from app.main import app

client = TestClient(app)
MATCH = 3869685  # demo match; timeline has goals at 22.4, 35.6, 79.6, 80.6


def goal_minute():
    tl = client.get(f"/matches/{MATCH}/timeline").json()
    return next(e["minute"] for e in tl if e["type"] == "goal")


def test_health_capability_flag(monkeypatch):
    monkeypatch.setenv("RECONSTRUCTION_UPLOAD_ENABLED", "true")
    assert client.get("/health").json()["capabilities"]["reconstruction_upload"] is True
    monkeypatch.delenv("RECONSTRUCTION_UPLOAD_ENABLED")
    assert (
        client.get("/health").json()["capabilities"]["reconstruction_upload"] is False
    )


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
