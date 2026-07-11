"""Turns one StatsBomb match into the derived objects/files the replay
engine serves. Pure with respect to I/O except write_match; StatsBomb
access goes through app.statsbomb_gateway so tests can fake it.

Regulation time only (periods 1-2, stoppage clamped to 90.0) — the model
predicts 90-minute finals by definition (docs/DESIGN.md)."""

import json
from pathlib import Path

from app import statsbomb_gateway

STEP = 0.5
BIG_CHANCE_XG = 0.25

# Trailing windows (minutes) for derived stats, per docs/DESIGN.md
MOMENTUM_WINDOW = 10
FOUL_FLURRY_WINDOW = 8
FOUL_FLURRY_COUNT = 4


def derive_match(meta, ev, frames=None) -> dict:
    """frames: optional 360 freeze-frame DataFrame (one row per visible
    player per event id, from statsbomb_gateway.frames). None/empty =
    match without 360 coverage — moments come out empty, timeline goals
    get has_3d=False, everything else is unaffected."""
    import pandas as pd

    home, away = meta["home_team"], meta["away_team"]
    ev = ev[ev["period"] <= 2].copy()
    ev["t"] = (ev["minute"] + ev["second"] / 60).clip(upper=90.0)
    # StatsBomb restarts period-2 clocks at 45:00 while first-half
    # stoppage time runs past 45 — without these clamps, end-of-H1 and
    # start-of-H2 events interleave when sorted by t (a stoppage-time
    # shot gets "followed" 0.6s later by a kickoff pass in midfield).
    ev.loc[ev["period"] == 1, "t"] = ev.loc[ev["period"] == 1, "t"].clip(upper=45.0)
    ev.loc[ev["period"] == 2, "t"] = ev.loc[ev["period"] == 2, "t"].clip(lower=45.0)
    ev = ev.sort_values(["t", "period"], kind="stable")

    # statsbombpy only includes a column if some event in *this* match
    # has it — e.g. a match with zero red/second-yellow cards simply
    # lacks "bad_behaviour_card" entirely. Backfill any expected column
    # that's absent; a missing column correctly means "no such event
    # occurred", not an error.
    for col in (
        "shot_statsbomb_xg",
        "shot_outcome",
        "shot_type",
        "pass_type",
        "foul_committed_card",
        "foul_committed_penalty",
        "bad_behaviour_card",
        "tactics",
        "player",
        "location",
        "pass_end_location",
        "carry_end_location",
        "shot_end_location",
    ):
        if col not in ev.columns:
            ev[col] = pd.NA

    is_shot = ev["type"] == "Shot"
    # Own goals are a distinct event type ("Own Goal For" / "Own Goal
    # Against"), not a Shot with outcome=="Goal" — miss this and any
    # match with an own goal under-reports the score.
    is_own_goal_for = ev["type"] == "Own Goal For"
    is_goal = (is_shot & (ev["shot_outcome"] == "Goal")) | is_own_goal_for
    is_corner = ev["pass_type"] == "Corner"
    is_foul = ev["type"] == "Foul Committed"
    is_card = ev["foul_committed_card"].notna() | ev["bad_behaviour_card"].notna()
    is_pressure = ev["type"] == "Pressure"
    xg = ev["shot_statsbomb_xg"].fillna(0.0)

    def per_team(mask):
        sub = ev[mask]
        return [int((sub["team"] == home).sum()), int((sub["team"] == away).sum())]

    def xg_pair(mask):
        sub = ev[mask]
        g = xg[mask]
        return [
            round(float(g[sub["team"] == home].sum()), 2),
            round(float(g[sub["team"] == away].sum()), 2),
        ]

    # ---- formations timeline (Starting XI + Tactical Shift events) ----
    def formation_str(v) -> str | None:
        if not isinstance(v, dict):
            return None
        f = v.get("formation")
        return "-".join(str(f)) if f is not None else None

    tactics_rows = ev[ev["tactics"].notna()][["t", "team", "tactics"]]
    formation_changes: list[tuple[float, str, str]] = []
    for _, row in tactics_rows.iterrows():
        s = formation_str(row["tactics"])
        if s:
            formation_changes.append((float(row["t"]), str(row["team"]), s))

    def formations_at(m: float) -> list[str]:
        current = {home: "—", away: "—"}
        for t, team, f in formation_changes:
            if t <= m:
                current[team] = f
        return [current[home], current[away]]

    # ---- snapshots every 0.5 min ----
    snapshots = []
    n_steps = int(90 / STEP) + 1
    for i in range(n_steps):
        m = round(i * STEP, 1)
        upto = ev["t"] <= m
        window_lo = m - MOMENTUM_WINDOW

        score = per_team(is_goal & upto)
        shots = per_team(is_shot & upto)
        xg_now = xg_pair(is_shot & upto)

        # possession: share of events by possession_team (documented approximation)
        sub = ev[upto]
        n = len(sub)
        poss_home = (
            round(100 * (sub["possession_team"] == home).sum() / n) if n else 50
        )

        # pressing: pressure events per opposition possession
        possessions_home = sub[sub["possession_team"] == home]["possession"].nunique()
        possessions_away = sub[sub["possession_team"] == away]["possession"].nunique()
        pressures = per_team(is_pressure & upto)
        pressing = [
            round(pressures[0] / max(1, possessions_away), 2),
            round(pressures[1] / max(1, possessions_home), 2),
        ]

        # momentum: trailing-window xG differential squashed to 0..1 toward home
        in_window = is_shot & upto & (ev["t"] > window_lo)
        xg_win = xg_pair(in_window)
        diff = xg_win[0] - xg_win[1]
        momentum = round(0.5 + max(-0.5, min(0.5, diff * 0.6)), 2)

        # foul flurry: combined fouls in trailing window
        recent_fouls = int((is_foul & upto & (ev["t"] > m - FOUL_FLURRY_WINDOW)).sum())
        foul_flurry = recent_fouls >= FOUL_FLURRY_COUNT

        combined_pressing = pressing[0] + pressing[1]
        snapshots.append(
            {
                "minute": m,
                "score": score,
                "xg": xg_now,
                "shots": shots,
                "corners": per_team(is_corner & upto),
                "cards": per_team(is_card & upto),
                "fouls": per_team(is_foul & upto),
                "possession_split": [poss_home, 100 - poss_home],
                "pressing": pressing,
                "momentum": momentum,
                "foul_flurry": foul_flurry,
                "formations": formations_at(m),
                # exact key names scripts/build_dataset.py trains on, so this
                # snapshot can be forwarded verbatim to the fine-tuned model
                "shots_accumulated": shots[0] + shots[1],
                "momentum_10m": (
                    f"{'+' if diff >= 0 else ''}{diff:.1f} xG "
                    f"({'home' if diff >= 0 else 'away'} surge)"
                    if abs(diff) >= 0.05
                    else "Neutral (0.0 xG)"
                ),
                "pressing_intensity": "High" if combined_pressing >= 1.4 else "Moderate",
            }
        )

    # own-goal pairs are linked via related_events; index the "Against"
    # side by id so the "For" event (the one that counts toward the
    # score) can look up who actually scored it
    own_goal_against_by_id = (
        ev[ev["type"] == "Own Goal Against"].set_index("id")
        if (ev["type"] == "Own Goal Against").any()
        else ev.iloc[0:0].set_index("id")
    )

    # ---- timeline (goals, cards, big chances) ----
    timeline = []
    for _, row in ev[is_goal | is_card | (is_shot & ~is_goal & (xg >= BIG_CHANCE_XG))].iterrows():
        display_min = int(row["minute"]) + 1
        team = str(row["team"])
        player = str(row["player"]) if isinstance(row["player"], str) else ""
        if row["type"] == "Own Goal For":
            kind = "goal"
            scorer_row = None
            related = row.get("related_events")
            for rel_id in related if isinstance(related, list) else []:
                if rel_id in own_goal_against_by_id.index:
                    scorer_row = own_goal_against_by_id.loc[rel_id]
                    break
            if scorer_row is not None:
                label = f"Own goal — {team} (via {scorer_row['player']}, {scorer_row['team']})"
            else:
                label = f"Own goal — {team}"
        elif row["type"] == "Shot" and row["shot_outcome"] == "Goal":
            kind = "goal"
            how = "penalty" if row.get("shot_type") == "Penalty" else "open play"
            label = f"Goal — {team} {how} ({player})"
        elif row["type"] == "Shot":
            kind = "chance"
            label = f"Big chance — {team}"
        else:
            card = (
                row["foul_committed_card"]
                if pd.notna(row["foul_committed_card"])
                else row["bad_behaviour_card"]
            )
            kind = "card"
            label = f"{card} — {team}"
        timeline.append(
            {
                "display_min": display_min,
                "minute": round(float(row["t"]), 1),
                "type": kind,
                "team": team,
                "player": player,
                "label": label,
            }
        )
    timeline.sort(key=lambda e: (e["minute"], e["display_min"]))

    # ---- flow (Layer 2: 2D living pitch) ----
    # One compact row per *located* regulation event:
    #   [t, x, y, code, side, endX, endY]   (endX/endY null unless
    #   pass/carry/shot, which carry an end location)
    # THE SILENT-BUG GUARD (docs/DESIGN.md "coordinate normalization"):
    # StatsBomb records BOTH teams as attacking left→right, so away-team
    # coordinates (and end locations) are flipped (120−x, 80−y) into one
    # shared frame. Skipping this renders a garbled pitch that still
    # "works" — hence the dedicated fixture test.
    def _xy(v) -> tuple[float, float] | None:
        if isinstance(v, (list, tuple)) and len(v) >= 2:
            return float(v[0]), float(v[1])
        return None

    _END_COL = {
        "Pass": "pass_end_location",
        "Carry": "carry_end_location",
        "Shot": "shot_end_location",  # 3D; z dropped here, kept for Layer 3a
    }
    _CODE = {
        "Pass": "pass",
        "Carry": "carry",
        "Shot": "shot",
        "Foul Committed": "foul",
        "Pressure": "pressure",
        # located at the KEEPER, not the ball — clients exclude it from
        # ball-path rendering, same as pressure
        "Goal Keeper": "keeper",
    }

    flow = []
    for _, row in ev.iterrows():
        start = _xy(row["location"])
        if start is None:
            continue
        etype = str(row["type"])
        is_away = str(row["team"]) == away
        x, y = start
        if is_away:
            x, y = 120.0 - x, 80.0 - y
        pass_type = row["pass_type"]
        # restarts after the ball left play get their own codes so the
        # pitch can announce them ("throw-in", "goal kick", "corner")
        _RESTART = {"Corner": "corner", "Throw-in": "throw_in", "Goal Kick": "goal_kick"}
        if isinstance(pass_type, str) and pass_type in _RESTART:
            code = _RESTART[pass_type]
        elif etype == "Foul Committed" and (
            pd.notna(row["foul_committed_penalty"]) and bool(row["foul_committed_penalty"])
        ):
            # a foul that concedes a penalty says "penalty", even when it
            # also drew a card
            code = "penalty"
        elif pd.notna(row["foul_committed_card"]) or pd.notna(row["bad_behaviour_card"]):
            code = "card"
        else:
            code = _CODE.get(etype, "other")
        end = _xy(row[_END_COL[etype]]) if etype in _END_COL else None
        if end is not None and is_away:
            end = (120.0 - end[0], 80.0 - end[1])
        flow.append(
            [
                round(float(row["t"]), 2),
                round(x, 1),
                round(y, 1),
                code,
                "a" if is_away else "h",
                round(end[0], 1) if end else None,
                round(end[1], 1) if end else None,
            ]
        )

    # ---- moments (Layer 3a: 360 diorama) ----
    # One entry per SHOT goal (own goals have no shooter freeze-frame →
    # no moment, has_3d False). Player positions come from the 360
    # freeze-frame for the shot event; 360 coords share the event
    # coordinate convention (attacking left→right), so away-team goals
    # get the same (120−x, 80−y) flip as flow. Shot end keeps z (height
    # into the goal) — that's the diorama's data-driven ball arc.
    moments = []
    if frames is not None and len(frames):
        for _, row in ev[is_goal & is_shot].iterrows():
            sub = frames[frames["id"] == row["id"]]
            if sub.empty:
                continue
            goal_away = str(row["team"]) == away

            def _flip(x: float, y: float) -> tuple[float, float]:
                return (120.0 - x, 80.0 - y) if goal_away else (x, y)

            start = _xy(row["location"])
            if start:
                start = [round(v, 1) for v in _flip(*start)]
            end3 = row["shot_end_location"]
            end = None
            if isinstance(end3, (list, tuple)) and len(end3) >= 2:
                ex, ey = _flip(float(end3[0]), float(end3[1]))
                ez = float(end3[2]) if len(end3) > 2 else 0.0
                end = [round(ex, 1), round(ey, 1), round(ez, 2)]

            players = []
            for _, p in sub.iterrows():
                loc = _xy(p["location"])
                if loc is None:
                    continue
                px, py = _flip(*loc)
                on_goal_team = bool(p["teammate"]) or bool(p["actor"])
                if goal_away:
                    side = "a" if on_goal_team else "h"
                else:
                    side = "h" if on_goal_team else "a"
                players.append(
                    {
                        "x": round(px, 1),
                        "y": round(py, 1),
                        "side": side,
                        "actor": bool(p["actor"]),
                        "keeper": bool(p["keeper"]),
                    }
                )

            moments.append(
                {
                    "minute": round(float(row["t"]), 1),
                    "display_min": int(row["minute"]) + 1,
                    "team": "a" if goal_away else "h",
                    "scorer": str(row["player"]) if isinstance(row["player"], str) else "",
                    "penalty": isinstance(row["shot_type"], str)
                    and row["shot_type"] == "Penalty",
                    "xg": round(float(row["shot_statsbomb_xg"]), 2)
                    if pd.notna(row["shot_statsbomb_xg"])
                    else None,
                    "shot_start": start,
                    "shot_end": end,
                    "players": players,
                }
            )

    moment_minutes = {m["minute"] for m in moments}
    for e in timeline:
        if e["type"] == "goal":
            e["has_3d"] = e["minute"] in moment_minutes

    final = snapshots[-1]
    season_name = str(meta.get("season", "")).strip()
    stage = str(meta.get("competition_stage", "")).strip()
    label_bits = [b for b in (meta.get("competition_name"), season_name, stage) if b]
    entry = {
        "match_id": int(meta["match_id"]),
        "home_team": str(home),
        "away_team": str(away),
        "label": " · ".join(str(b) for b in label_bits) or f"Match {meta['match_id']}",
        "date": str(meta["match_date"]),
        "regulation_score": final["score"],
    }
    return {
        "entry": entry,
        "snapshots": snapshots,
        "timeline": timeline,
        "flow": flow,
        "moments": moments,
    }


def fetch_and_derive(competition_id: int, season_id: int, match_id: int) -> dict:
    matches = statsbomb_gateway.matches(competition_id, season_id)
    rows = matches[matches["match_id"] == match_id]
    if rows.empty:
        raise LookupError(
            f"match_id {match_id} not found in competition_id={competition_id} "
            f"season_id={season_id}"
        )
    ev = statsbomb_gateway.events(match_id)
    try:
        frames = statsbomb_gateway.frames(match_id)
    except Exception:
        # no 360 coverage for this match (or fetch hiccup) — degrade
        # gracefully to no moments rather than failing the whole add
        frames = None
    return derive_match(rows.iloc[0], ev, frames)


def delete_match(match_id: int, out_dir: Path) -> None:
    """Remove a match's derived files, its catalog entry, and any
    uploaded reconstruction clips/status for it (Layer 3b)."""
    catalog_path = out_dir / "matches.json"
    if catalog_path.exists():
        catalog = json.loads(catalog_path.read_text())
        catalog = [m for m in catalog if m["match_id"] != match_id]
        catalog_path.write_text(json.dumps(catalog, indent=1))
    (out_dir / f"{match_id}_snapshots.json").unlink(missing_ok=True)
    (out_dir / f"{match_id}_timeline.json").unlink(missing_ok=True)
    (out_dir / f"{match_id}_flow.json").unlink(missing_ok=True)
    (out_dir / f"{match_id}_moments.json").unlink(missing_ok=True)

    clips_status_path = out_dir / "clips_status.json"
    if clips_status_path.exists():
        statuses = json.loads(clips_status_path.read_text())
        if statuses.pop(str(match_id), None) is not None:
            clips_status_path.write_text(json.dumps(statuses, indent=1))
    for clip_file in (out_dir / "clips").glob(f"{match_id}_*"):
        clip_file.unlink(missing_ok=True)


def write_match(data: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    match_id = data["entry"]["match_id"]
    catalog_path = out_dir / "matches.json"
    catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else []
    catalog = [m for m in catalog if m["match_id"] != match_id]
    catalog.append(data["entry"])
    catalog_path.write_text(json.dumps(catalog, indent=1))
    (out_dir / f"{match_id}_snapshots.json").write_text(json.dumps(data["snapshots"]))
    (out_dir / f"{match_id}_timeline.json").write_text(json.dumps(data["timeline"], indent=1))
    # compact on purpose (~100–150KB/match); .get so data derived before
    # the flow feature still writes cleanly
    (out_dir / f"{match_id}_flow.json").write_text(json.dumps(data.get("flow", [])))
    (out_dir / f"{match_id}_moments.json").write_text(
        json.dumps(data.get("moments", []), indent=1)
    )
