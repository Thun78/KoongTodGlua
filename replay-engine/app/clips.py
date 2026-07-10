"""Clip intake for 3D reconstruction (Layer 3b). Stores uploaded goal
clips on the data volume and tracks per-goal job status in
clips_status.json. reconstruction-svc consumes clips later; until it
reports back, uploads stay 'queued'."""

import datetime
import json
import threading
from pathlib import Path

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm"}
MAX_CLIP_BYTES = 100_000_000
CHUNK = 1 << 20

_lock = threading.Lock()


class OversizeError(Exception):
    pass


def _status_path(data_dir: Path) -> Path:
    return data_dir / "clips_status.json"


def _load(data_dir: Path) -> dict:
    p = _status_path(data_dir)
    return json.loads(p.read_text()) if p.exists() else {}


def _write(data_dir: Path, all_statuses: dict) -> None:
    _status_path(data_dir).write_text(json.dumps(all_statuses, indent=1))


def clip_statuses(data_dir: Path, match_id: int) -> dict:
    return _load(data_dir).get(str(match_id), {})


def set_status(
    data_dir: Path, match_id: int, minute: float, status: str, error: str | None = None
) -> None:
    with _lock:
        allst = _load(data_dir)
        entry = allst.setdefault(str(match_id), {}).setdefault(str(minute), {})
        entry["status"] = status
        if error is None:
            entry.pop("error", None)
        else:
            entry["error"] = error
        _write(data_dir, allst)


def save_clip(data_dir: Path, match_id: int, minute: float, filename: str, stream) -> dict:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"unsupported file type {ext or '(none)'}; use mp4/mov/webm")
    clips_dir = data_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    dest = clips_dir / f"{match_id}_{minute}{ext}"
    written = 0
    try:
        with dest.open("wb") as f:
            while chunk := stream.read(CHUNK):
                written += len(chunk)
                if written > MAX_CLIP_BYTES:
                    raise OversizeError(
                        f"clip exceeds {MAX_CLIP_BYTES // 1_000_000}MB limit"
                    )
                f.write(chunk)
    except OversizeError:
        dest.unlink(missing_ok=True)
        raise
    entry = {
        "status": "queued",
        "filename": filename,
        "uploaded_at": datetime.datetime.now(datetime.UTC).isoformat(
            timespec="seconds"
        ),
    }
    with _lock:
        allst = _load(data_dir)
        allst.setdefault(str(match_id), {})[str(minute)] = entry
        _write(data_dir, allst)
    return entry
