"""Response contracts. MatchStateSnapshot is a superset of the
match_state shape scripts/build_dataset.py trains the Gemma fine-tune
on (minute, shots_accumulated, momentum_10m, possession_split,
pressing_intensity), so a snapshot can be forwarded to the model
verbatim."""

from typing import Literal

from pydantic import BaseModel


class MatchInfo(BaseModel):
    match_id: int
    home_team: str
    away_team: str
    label: str
    date: str
    regulation_score: list[int]


class TimelineEvent(BaseModel):
    display_min: int
    minute: float
    type: Literal["goal", "card", "chance"]
    team: str
    player: str
    label: str


class MatchStateSnapshot(BaseModel):
    minute: float
    score: list[int]
    xg: list[float]
    shots: list[int]
    corners: list[int]
    cards: list[int]
    fouls: list[int]
    possession_split: list[int]
    pressing: list[float]
    momentum: float
    foul_flurry: bool
    formations: list[str]
    # build_dataset.py contract keys
    shots_accumulated: int
    momentum_10m: str
    pressing_intensity: str


class Capabilities(BaseModel):
    reconstruction_upload: bool


class Health(BaseModel):
    status: str
    matches_loaded: int
    capabilities: Capabilities


class Season(BaseModel):
    season_id: int
    season_name: str


class CompetitionSeasons(BaseModel):
    competition_id: int
    competition_name: str
    seasons: list[Season]


class CatalogMatch(BaseModel):
    match_id: int
    date: str
    stage: str
    home_team: str
    away_team: str
    home_score: int
    away_score: int


class AddMatchRequest(BaseModel):
    competition_id: int
    season_id: int
    match_id: int
