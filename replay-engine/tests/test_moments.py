"""Layer 3a moments derivation: 360 freeze-frame extraction per shot
goal, the away-team coordinate flip, side mapping from teammate/actor
flags, has_3d on timeline goals, graceful no-360 fallback, and the
file/store roundtrip."""

import json

import pandas as pd
import pytest

from app.derive import derive_match, delete_match, write_match
from app.store import MatchStore


def _e(**kw):
    e = {
        "id": kw.get("id", "e0"),
        "period": 1,
        "minute": 0,
        "second": 0,
        "type": "Pass",
        "team": "HomeFC",
        "player": "Some Player",
        "possession": 1,
        "possession_team": "HomeFC",
        "related_events": None,
        "location": None,
    }
    e.update(kw)
    return e


@pytest.fixture
def goal_events():
    rows = [
        # home shot goal WITH a freeze-frame
        _e(id="hg", minute=10, type="Shot", team="HomeFC", player="Home Striker",
           location=[108.0, 42.0], shot_end_location=[120.0, 41.0, 0.5],
           shot_outcome="Goal", shot_statsbomb_xg=0.4, shot_type="Open Play"),
        # away shot goal WITH a freeze-frame → everything must flip
        _e(id="ag", minute=60, period=2, type="Shot", team="AwayFC", player="Away Striker",
           location=[110.0, 30.0], shot_end_location=[120.0, 44.0, 1.8],
           shot_outcome="Goal", shot_statsbomb_xg=0.2, shot_type="Penalty"),
        # home shot goal WITHOUT a freeze-frame → no moment, has_3d False
        _e(id="ng", minute=80, period=2, type="Shot", team="HomeFC", player="Late Scorer",
           location=[100.0, 40.0], shot_end_location=[120.0, 40.0],
           shot_outcome="Goal", shot_statsbomb_xg=0.1, shot_type="Open Play"),
    ]
    df = pd.DataFrame(rows)
    df["tactics"] = None
    return df


@pytest.fixture
def fake_frames():
    """One row per visible player per event id (statsbombpy sb.frames
    dataframe shape). Flags are relative to the EVENT team."""
    rows = [
        # home goal "hg": the shooter, a teammate, and the away keeper
        {"id": "hg", "teammate": True, "actor": True, "keeper": False, "location": [108.0, 42.0]},
        {"id": "hg", "teammate": True, "actor": False, "keeper": False, "location": [95.0, 30.0]},
        {"id": "hg", "teammate": False, "actor": False, "keeper": True, "location": [118.0, 40.0]},
        # away goal "ag": shooter + opposing (home) keeper
        {"id": "ag", "teammate": True, "actor": True, "keeper": False, "location": [110.0, 30.0]},
        {"id": "ag", "teammate": False, "actor": False, "keeper": True, "location": [117.0, 38.0]},
        # player with junk location → skipped
        {"id": "ag", "teammate": False, "actor": False, "keeper": False, "location": None},
    ]
    return pd.DataFrame(rows)


def _moments(fake_meta, ev, frames):
    return derive_match(fake_meta, ev, frames)["moments"]


def test_one_moment_per_goal_with_frame(fake_meta, goal_events, fake_frames):
    moments = _moments(fake_meta, goal_events, fake_frames)
    assert len(moments) == 2  # "ng" has no freeze-frame
    assert [m["scorer"] for m in moments] == ["Home Striker", "Away Striker"]


def test_home_goal_unflipped(fake_meta, goal_events, fake_frames):
    m = _moments(fake_meta, goal_events, fake_frames)[0]
    assert m["team"] == "h" and m["penalty"] is False
    assert m["shot_start"] == [108.0, 42.0]
    assert m["shot_end"] == [120.0, 41.0, 0.5]
    shooter = next(p for p in m["players"] if p["actor"])
    assert (shooter["x"], shooter["y"], shooter["side"]) == (108.0, 42.0, "h")
    keeper = next(p for p in m["players"] if p["keeper"])
    assert keeper["side"] == "a"  # defending keeper is the away team


def test_away_goal_flipped_including_z(fake_meta, goal_events, fake_frames):
    m = _moments(fake_meta, goal_events, fake_frames)[1]
    assert m["team"] == "a" and m["penalty"] is True
    assert m["shot_start"] == [10.0, 50.0]        # 120−110, 80−30
    assert m["shot_end"] == [0.0, 36.0, 1.8]      # flipped x,y; z preserved
    shooter = next(p for p in m["players"] if p["actor"])
    assert (shooter["x"], shooter["y"], shooter["side"]) == (10.0, 50.0, "a")
    keeper = next(p for p in m["players"] if p["keeper"])
    assert (keeper["x"], keeper["y"], keeper["side"]) == (3.0, 42.0, "h")
    assert len(m["players"]) == 2  # junk-location row skipped


def test_timeline_has_3d_flags(fake_meta, goal_events, fake_frames):
    tl = derive_match(fake_meta, goal_events, fake_frames)["timeline"]
    goals = {e["display_min"]: e["has_3d"] for e in tl if e["type"] == "goal"}
    assert goals == {11: True, 61: True, 81: False}


def test_no_frames_means_no_moments(fake_meta, goal_events):
    for frames in (None, pd.DataFrame(columns=["id", "teammate", "actor", "keeper", "location"])):
        out = derive_match(fake_meta, goal_events, frames)
        assert out["moments"] == []
        assert all(not e["has_3d"] for e in out["timeline"] if e["type"] == "goal")


def test_own_goal_never_gets_moment(fake_meta, fake_events):
    """conftest fixture contains an own goal — must not crash and must
    not produce a moment (no shot, no freeze-frame)."""
    frames = pd.DataFrame(columns=["id", "teammate", "actor", "keeper", "location"])
    out = derive_match(fake_meta, fake_events, frames)
    assert out["moments"] == []


def test_write_load_delete_roundtrip(fake_meta, goal_events, fake_frames, tmp_path):
    data = derive_match(fake_meta, goal_events, fake_frames)
    write_match(data, tmp_path)
    path = tmp_path / "111_moments.json"
    assert json.loads(path.read_text()) == data["moments"]

    store = MatchStore(data_dir=tmp_path)
    assert store.moments(111) == data["moments"]
    assert store.moments(999) is None

    delete_match(111, tmp_path)
    assert not path.exists()


def test_store_empty_fallback_for_pre_moments_data(fake_meta, goal_events, fake_frames, tmp_path):
    data = derive_match(fake_meta, goal_events, fake_frames)
    write_match(data, tmp_path)
    (tmp_path / "111_moments.json").unlink()
    store = MatchStore(data_dir=tmp_path)
    assert store.moments(111) == []
