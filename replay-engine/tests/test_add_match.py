from fastapi.testclient import TestClient

import app.main as main_mod
from app import derive
from app.main import app

client = TestClient(app)
MATCH = 3869685  # baked demo match, present via app/data


def test_snapshots_bulk():
    r = client.get(f"/matches/{MATCH}/snapshots")
    assert r.status_code == 200
    assert len(r.json()) == 181
    assert r.json()[-1]["score"] == [2, 2]


def test_snapshots_unknown_404():
    assert client.get("/matches/999/snapshots").status_code == 404


def test_add_match_idempotent_when_already_loaded():
    r = client.post("/matches", json={"competition_id": 43, "season_id": 106, "match_id": MATCH})
    assert r.status_code == 200
    assert r.json()["match_id"] == MATCH  # no fetch attempted — already in store


def test_add_match_fetches_and_hot_adds(monkeypatch, tmp_path, fake_meta, fake_events):
    def fake_fetch(c, s, m):
        return derive.derive_match(fake_meta, fake_events)

    monkeypatch.setattr(main_mod.derive, "fetch_and_derive", fake_fetch)
    monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
    r = client.post("/matches", json={"competition_id": 1, "season_id": 2, "match_id": 111})
    assert r.status_code == 200
    assert r.json()["home_team"] == "HomeFC"
    assert client.get("/matches/111/snapshots").status_code == 200
    assert (tmp_path / "111_snapshots.json").exists()
    # cleanup so other tests see only the demo match
    main_mod.store.matches.pop(111, None)


def test_delete_match(monkeypatch, tmp_path, fake_meta, fake_events):
    def fake_fetch(c, s, m):
        return derive.derive_match(fake_meta, fake_events)

    monkeypatch.setattr(main_mod.derive, "fetch_and_derive", fake_fetch)
    monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
    client.post("/matches", json={"competition_id": 1, "season_id": 2, "match_id": 111})
    assert (tmp_path / "111_snapshots.json").exists()

    r = client.delete("/matches/111")
    assert r.status_code == 204
    assert 111 not in main_mod.store.matches
    assert not (tmp_path / "111_snapshots.json").exists()
    assert not (tmp_path / "111_timeline.json").exists()
    import json

    catalog = json.loads((tmp_path / "matches.json").read_text())
    assert all(m["match_id"] != 111 for m in catalog)


def test_delete_unknown_404():
    assert client.delete("/matches/424242").status_code == 404


def test_add_match_unknown_404(monkeypatch):
    def raise_lookup(c, s, m):
        raise LookupError("nope")

    monkeypatch.setattr(main_mod.derive, "fetch_and_derive", raise_lookup)
    r = client.post("/matches", json={"competition_id": 1, "season_id": 2, "match_id": 999})
    assert r.status_code == 404


def test_add_match_upstream_failure_502(monkeypatch):
    def raise_net(c, s, m):
        raise ConnectionError("github down")

    monkeypatch.setattr(main_mod.derive, "fetch_and_derive", raise_net)
    r = client.post("/matches", json={"competition_id": 1, "season_id": 2, "match_id": 998})
    assert r.status_code == 502
