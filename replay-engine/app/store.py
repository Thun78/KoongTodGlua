"""Loads the derived JSONs produced by scripts/fetch_match.py and
answers lookups. All data fits comfortably in memory (one match is
~200KB derived); a request is a list index, never a computation."""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
SNAPSHOT_STEP = 0.5


class MatchStore:
    def __init__(self, data_dir: Path = DATA_DIR):
        self.matches: dict[int, dict] = {}
        catalog_path = data_dir / "matches.json"
        if not catalog_path.exists():
            raise RuntimeError(
                f"No match data in {data_dir}. Run replay-engine/scripts/"
                "fetch_match.py first (or build via Docker, whose fetch "
                "stage does this)."
            )
        for info in json.loads(catalog_path.read_text()):
            mid = info["match_id"]
            self.matches[mid] = {
                "info": info,
                "snapshots": json.loads(
                    (data_dir / f"{mid}_snapshots.json").read_text()
                ),
                "timeline": json.loads(
                    (data_dir / f"{mid}_timeline.json").read_text()
                ),
            }

    def add_match(self, entry: dict, snapshots: list[dict], timeline: list[dict]) -> None:
        self.matches[entry["match_id"]] = {
            "info": entry,
            "snapshots": snapshots,
            "timeline": timeline,
        }

    def catalog(self) -> list[dict]:
        return [m["info"] for m in self.matches.values()]

    def timeline(self, match_id: int) -> list[dict] | None:
        m = self.matches.get(match_id)
        return m["timeline"] if m else None

    def state(self, match_id: int, minute: float) -> dict | None:
        """Snapshot nearest to `minute` (snapshots are every 0.5 min)."""
        m = self.matches.get(match_id)
        if not m:
            return None
        snaps = m["snapshots"]
        idx = min(len(snaps) - 1, max(0, round(minute / SNAPSHOT_STEP)))
        return snaps[idx]
