"""Layer 2 flow derivation: the coordinate-flip fixture (the
silent-bug guard from docs/DESIGN.md), event codes, ordering, file
roundtrip, and the store's graceful-empty fallback for matches derived
before the flow feature existed."""

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
def located_events():
    rows = [
        # home pass, coords must pass through UNCHANGED
        _e(id="hp", minute=1, type="Pass", team="HomeFC",
           location=[60.0, 40.0], pass_end_location=[80.0, 20.0]),
        # away pass, start AND end must flip (120−x, 80−y)
        _e(id="ap", minute=2, type="Pass", team="AwayFC",
           location=[20.0, 10.0], pass_end_location=[40.0, 30.0]),
        # away corner → code "corner", flipped
        _e(id="ac", minute=3, type="Pass", team="AwayFC",
           location=[120.0, 80.0], pass_type="Corner"),
        # home foul WITH card → code "card"
        _e(id="hc", minute=4, type="Foul Committed", team="HomeFC",
           location=[50.0, 40.0], foul_committed_card="Yellow Card"),
        # away shot with 3D end location (z dropped in flow)
        _e(id="as", minute=5, type="Shot", team="AwayFC",
           location=[100.0, 40.0], shot_end_location=[120.0, 38.0, 1.5],
           shot_outcome="Saved", shot_statsbomb_xg=0.1),
        # unlocated event → must be skipped entirely
        _e(id="nx", minute=6, type="Half End", team="HomeFC", location=None),
        # home carry
        _e(id="hk", minute=7, type="Carry", team="HomeFC",
           location=[30.0, 30.0], carry_end_location=[45.0, 35.0]),
    ]
    df = pd.DataFrame(rows)
    df["tactics"] = None
    return df


def _flow(fake_meta, events):
    return derive_match(fake_meta, events)["flow"]


def test_home_coords_unchanged(fake_meta, located_events):
    flow = _flow(fake_meta, located_events)
    t, x, y, code, side, ex, ey = flow[0]
    assert (x, y) == (60.0, 40.0)
    assert (ex, ey) == (80.0, 20.0)
    assert side == "h" and code == "pass"


def test_away_coords_flipped(fake_meta, located_events):
    """THE silent-bug guard: away teams are recorded attacking
    left→right too, so their coords must mirror into the shared frame."""
    flow = _flow(fake_meta, located_events)
    t, x, y, code, side, ex, ey = flow[1]
    assert (x, y) == (100.0, 70.0)   # 120−20, 80−10
    assert (ex, ey) == (80.0, 50.0)  # 120−40, 80−30
    assert side == "a"


def test_event_codes(fake_meta, located_events):
    codes = [r[3] for r in _flow(fake_meta, located_events)]
    assert codes == ["pass", "pass", "corner", "card", "shot", "carry"]


def test_corner_flipped_to_opposite_corner(fake_meta, located_events):
    t, x, y, *_ = _flow(fake_meta, located_events)[2]
    assert (x, y) == (0.0, 0.0)  # away [120,80] mirrors to origin


def test_shot_end_drops_z_and_flips(fake_meta, located_events):
    *_, ex, ey = _flow(fake_meta, located_events)[4]
    assert (ex, ey) == (0.0, 42.0)  # 120−120, 80−38; z=1.5 dropped


def test_unlocated_events_skipped_and_ordered(fake_meta, located_events):
    flow = _flow(fake_meta, located_events)
    assert len(flow) == 6  # 7 rows minus the unlocated Half End
    ts = [r[0] for r in flow]
    assert ts == sorted(ts)


def test_missing_location_columns_yield_empty_flow(fake_meta, fake_events):
    """conftest's fixture has no location columns at all (the
    missing-column case) — derivation must not crash."""
    assert derive_match(fake_meta, fake_events)["flow"] == []


def test_write_load_delete_roundtrip(fake_meta, located_events, tmp_path):
    data = derive_match(fake_meta, located_events)
    write_match(data, tmp_path)
    flow_path = tmp_path / "111_flow.json"
    assert json.loads(flow_path.read_text()) == data["flow"]

    store = MatchStore(data_dir=tmp_path)
    assert store.flow(111) == data["flow"]
    assert store.flow(999) is None  # unknown match

    delete_match(111, tmp_path)
    assert not flow_path.exists()


def test_store_empty_fallback_for_pre_flow_data(fake_meta, located_events, tmp_path):
    """Old volume data has no flow file — store must load it with an
    empty flow, not crash."""
    data = derive_match(fake_meta, located_events)
    write_match(data, tmp_path)
    (tmp_path / "111_flow.json").unlink()
    store = MatchStore(data_dir=tmp_path)
    assert store.flow(111) == []
