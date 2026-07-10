"""Thin seam over statsbombpy so tests can monkeypatch these three
functions instead of needing network. Imports statsbombpy lazily so the
FastAPI runtime only pays for it when the add-match path is used."""

import warnings


def competitions():
    warnings.filterwarnings("ignore")
    from statsbombpy import sb

    return sb.competitions()


def matches(competition_id: int, season_id: int):
    warnings.filterwarnings("ignore")
    from statsbombpy import sb

    return sb.matches(competition_id=competition_id, season_id=season_id)


def events(match_id: int):
    warnings.filterwarnings("ignore")
    from statsbombpy import sb

    return sb.events(match_id=match_id)


def frames(match_id: int):
    """360 freeze-frames; one flat row per visible player per event id
    (columns: id, teammate, actor, keeper, location).

    Deliberately does NOT use sb.frames(fmt="dataframe"): its concat-
    based conversion crashes with newer pandas (InvalidIndexError,
    non-unique index). We read the same raw open-data file statsbombpy
    would and flatten it ourselves. 404 = no 360 coverage for this
    match; callers treat any raise as 'no 360 data'."""
    import pandas as pd
    import requests

    url = (
        "https://raw.githubusercontent.com/statsbomb/open-data/"
        f"master/data/three-sixty/{match_id}.json"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    rows = []
    for event in r.json():
        for p in event.get("freeze_frame") or []:
            rows.append(
                {
                    "id": event["event_uuid"],
                    "teammate": bool(p.get("teammate", False)),
                    "actor": bool(p.get("actor", False)),
                    "keeper": bool(p.get("keeper", False)),
                    "location": p.get("location"),
                }
            )
    return pd.DataFrame(rows)
