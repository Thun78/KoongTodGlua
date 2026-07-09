"""Verifies the derived data against known facts of the 2022 final and
the API contract. Requires app/data to exist — run
scripts/fetch_match.py once before testing."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.store import DATA_DIR

MATCH = 3869685

pytestmark = pytest.mark.skipif(
    not (DATA_DIR / "matches.json").exists(),
    reason="no derived data — run replay-engine/scripts/fetch_match.py first",
)

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["matches_loaded"] == 1


def test_catalog():
    r = client.get("/matches")
    (m,) = r.json()
    assert m["match_id"] == MATCH
    assert m["home_team"] == "Argentina"
    assert m["away_team"] == "France"
    assert m["regulation_score"] == [2, 2]


def test_timeline_goals_at_known_minutes():
    r = client.get(f"/matches/{MATCH}/timeline")
    goals = [e for e in r.json() if e["type"] == "goal"]
    assert [g["display_min"] for g in goals] == [23, 36, 80, 81]
    assert goals[0]["team"] == "Argentina"
    assert "Messi" in goals[0]["player"]
    assert goals[2]["team"] == "France"


def test_state_scores_through_the_match():
    for minute, expected in [(0, [0, 0]), (23, [1, 0]), (50, [2, 0]), (81, [2, 2]), (90, [2, 2])]:
        r = client.get(f"/matches/{MATCH}/state", params={"minute": minute})
        assert r.status_code == 200
        assert r.json()["score"] == expected, f"at minute {minute}"


def test_xg_monotonically_nondecreasing():
    prev = [0.0, 0.0]
    for m in range(0, 91, 5):
        xg = client.get(f"/matches/{MATCH}/state", params={"minute": m}).json()["xg"]
        assert xg[0] >= prev[0] and xg[1] >= prev[1]
        prev = xg


def test_snapshot_carries_model_contract_keys():
    snap = client.get(f"/matches/{MATCH}/state", params={"minute": 45}).json()
    # exact keys scripts/build_dataset.py serializes for the fine-tune
    for key in ("minute", "shots_accumulated", "momentum_10m", "possession_split", "pressing_intensity"):
        assert key in snap
    assert snap["possession_split"][0] + snap["possession_split"][1] == 100


def test_unknown_match_404():
    assert client.get("/matches/999/timeline").status_code == 404
    assert client.get("/matches/999/state", params={"minute": 10}).status_code == 404


def test_minute_out_of_range_422():
    assert client.get(f"/matches/{MATCH}/state", params={"minute": 95}).status_code == 422
    assert client.get(f"/matches/{MATCH}/state", params={"minute": -1}).status_code == 422
