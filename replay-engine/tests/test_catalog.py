import pandas as pd
from fastapi.testclient import TestClient

from app import statsbomb_gateway
from app.main import app

client = TestClient(app)


def test_competitions_grouped(monkeypatch):
    fake = pd.DataFrame(
        [
            {"competition_id": 43, "competition_name": "FIFA World Cup", "season_id": 106, "season_name": "2022"},
            {"competition_id": 43, "competition_name": "FIFA World Cup", "season_id": 3, "season_name": "2018"},
            {"competition_id": 11, "competition_name": "La Liga", "season_id": 90, "season_name": "2020/2021"},
        ]
    )
    monkeypatch.setattr(statsbomb_gateway, "competitions", lambda: fake)
    app.state.catalog_cache = {}  # reset cache
    r = client.get("/catalog/competitions")
    assert r.status_code == 200
    wc = next(c for c in r.json() if c["competition_id"] == 43)
    assert {s["season_id"] for s in wc["seasons"]} == {106, 3}


def test_catalog_matches(monkeypatch):
    fake = pd.DataFrame(
        [
            {
                "match_id": 8658, "match_date": "2018-07-15", "competition_stage": "Final",
                "home_team": "France", "away_team": "Croatia", "home_score": 4, "away_score": 2,
            }
        ]
    )
    monkeypatch.setattr(statsbomb_gateway, "matches", lambda c, s: fake)
    app.state.catalog_cache = {}
    r = client.get("/catalog/matches", params={"competition_id": 43, "season_id": 3})
    assert r.status_code == 200
    assert r.json() == [
        {
            "match_id": 8658, "date": "2018-07-15", "stage": "Final",
            "home_team": "France", "away_team": "Croatia", "home_score": 4, "away_score": 2,
        }
    ]
