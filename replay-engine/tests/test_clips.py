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
