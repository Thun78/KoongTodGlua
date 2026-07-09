import json

from app.derive import derive_match, write_match


def test_score_includes_own_goals(fake_meta, fake_events):
    out = derive_match(fake_meta, fake_events)
    assert out["snapshots"][-1]["score"] == [1, 1]  # 1 shot-goal home, 1 own-goal-for away


def test_missing_columns_tolerated(fake_meta, fake_events):
    # frame lacks bad_behaviour_card/foul_committed_card/pass_type entirely
    out = derive_match(fake_meta, fake_events)
    assert out["snapshots"][-1]["cards"] == [0, 0]
    assert out["snapshots"][-1]["corners"] == [0, 0]


def test_own_goal_timeline_label(fake_meta, fake_events):
    out = derive_match(fake_meta, fake_events)
    og = [e for e in out["timeline"] if "Own goal" in e["label"]]
    assert len(og) == 1
    assert "Unlucky Defender" in og[0]["label"]


def test_entry_label_generic(fake_meta, fake_events):
    out = derive_match(fake_meta, fake_events)
    assert out["entry"]["label"] == "Test Cup · 2099 · Final"


def test_write_match_upserts(tmp_path, fake_meta, fake_events):
    out = derive_match(fake_meta, fake_events)
    write_match(out, tmp_path)
    write_match(out, tmp_path)  # idempotent
    catalog = json.loads((tmp_path / "matches.json").read_text())
    assert [m["match_id"] for m in catalog] == [111]
