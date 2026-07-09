"""Fetch a match from StatsBomb open data and precompute the derived
files the replay engine serves. Works with any match in StatsBomb's
open data, not just the hackathon demo — pass
--competition-id/--season-id/--match-id to pick one, or --list-matches
to discover valid IDs.

Thin CLI over app/derive.py (the same code POST /matches uses at
runtime). Runs on a dev machine or in the Docker fetch stage; outputs
into replay-engine/app/data/ (gitignored — StatsBomb's license forbids
redistributing their data).

Examples:
  # default: the hackathon demo match (2022 World Cup Final)
  python fetch_match.py

  # discover match IDs for a competition/season
  python fetch_match.py --competition-id 43 --season-id 3 --list-matches

  # fetch a specific different match
  python fetch_match.py --competition-id 43 --season-id 3 --match-id 8658
"""

import argparse
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # make `app` importable

from app import statsbomb_gateway
from app.derive import fetch_and_derive, write_match

DEFAULT_COMPETITION_ID = 43  # FIFA World Cup
DEFAULT_SEASON_ID = 106  # 2022
DEFAULT_MATCH_ID = 3869685  # Argentina vs France, the final


def list_matches(competition_id: int, season_id: int) -> None:
    matches = statsbomb_gateway.matches(competition_id, season_id)
    cols = [
        "match_id",
        "match_date",
        "competition_stage",
        "home_team",
        "home_score",
        "away_score",
        "away_team",
    ]
    print(matches[cols].sort_values("match_date").to_string(index=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--competition-id",
        type=int,
        default=DEFAULT_COMPETITION_ID,
        help=f"StatsBomb competition_id (default: {DEFAULT_COMPETITION_ID}, FIFA World Cup)",
    )
    parser.add_argument(
        "--season-id",
        type=int,
        default=DEFAULT_SEASON_ID,
        help=f"StatsBomb season_id (default: {DEFAULT_SEASON_ID}, 2022)",
    )
    parser.add_argument(
        "--match-id",
        type=int,
        default=DEFAULT_MATCH_ID,
        help=f"StatsBomb match_id to fetch (default: {DEFAULT_MATCH_ID}, the demo match)",
    )
    parser.add_argument(
        "--list-matches",
        action="store_true",
        help="list match_ids for --competition-id/--season-id and exit, instead of fetching",
    )
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "app" / "data"),
        help="output directory (default: replay-engine/app/data)",
    )
    args = parser.parse_args()

    if args.list_matches:
        list_matches(args.competition_id, args.season_id)
    else:
        print(f"Fetching match {args.match_id} from StatsBomb open data…")
        data = fetch_and_derive(args.competition_id, args.season_id, args.match_id)
        write_match(data, Path(args.out))
        final = data["snapshots"][-1]
        print(
            f"Wrote {len(data['snapshots'])} snapshots, "
            f"{len(data['timeline'])} timeline events → {args.out} · "
            f"regulation score {final['score'][0]}-{final['score'][1]}"
        )
