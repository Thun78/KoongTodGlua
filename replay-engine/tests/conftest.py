import pandas as pd
import pytest


def _base_event(**kw):
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
    }
    e.update(kw)
    return e


@pytest.fixture
def fake_meta():
    return pd.Series(
        {
            "match_id": 111,
            "home_team": "HomeFC",
            "away_team": "AwayFC",
            "competition_name": "Test Cup",
            "season": "2099",
            "competition_stage": "Final",
            "match_date": "2099-01-01",
        }
    )


@pytest.fixture
def fake_events():
    """Regulation-only frame WITHOUT bad_behaviour_card / pass_type /
    foul_committed_card columns (missing-column case) containing one
    normal goal for home and one own goal FOR away."""
    rows = [
        _base_event(id="s1", minute=10, type="Shot", team="HomeFC",
                    shot_outcome="Goal", shot_statsbomb_xg=0.5, shot_type="Open Play"),
        _base_event(id="og1", minute=30, type="Own Goal For", team="AwayFC",
                    related_events=["og2"]),
        _base_event(id="og2", minute=30, type="Own Goal Against", team="HomeFC",
                    player="Unlucky Defender", related_events=["og1"]),
        _base_event(id="p1", minute=40, type="Pressure", team="AwayFC"),
        _base_event(id="f1", minute=50, type="Foul Committed", team="HomeFC"),
    ]
    df = pd.DataFrame(rows)
    # tactics column present-but-empty; card/pass_type columns absent entirely
    df["tactics"] = None
    return df
