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
