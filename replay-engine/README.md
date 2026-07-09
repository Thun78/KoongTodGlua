# replay-engine

Serves precomputed match-state snapshots so the UI and the Gemma model
service can ask "what were the stats as of minute X". The client owns
the match clock; this service is stateless. Ships with the hackathon
demo match (2022 World Cup Final, Argentina vs France) fetched by
default, but works with any match in StatsBomb's open data.

Data source: [StatsBomb Open Data](https://github.com/statsbomb/open-data),
used under their public data user agreement. Any published analysis must
credit StatsBomb (logo attribution). The raw and derived data are **not
committed** to this repo; they are produced on demand.

## Endpoints

- `GET /health`
- `GET /matches` — catalog for the home screen
- `GET /matches/{id}/timeline` — goals / cards / big chances (display minutes)
- `GET /matches/{id}/state?minute=53.5` — full stats snapshot as of that minute
  (0–90, regulation only; snapshots are precomputed every 0.5 min)

The state payload is a superset of the `match_state` shape
`scripts/build_dataset.py` trains the fine-tune on, so it can be
forwarded verbatim to the model service.

## Run locally

```bash
# one-time: produce app/data/ for the demo match (needs network;
# uses repo .venv which has statsbombpy)
../.venv/bin/python scripts/fetch_match.py

# serve
../.venv/bin/python -m uvicorn app.main:app --port 8000

# test
../.venv/bin/python -m pytest
```

## Fetching other matches

`fetch_match.py` isn't hardcoded to the demo match — every match is
selected by `--competition-id`/`--season-id`/`--match-id`, all of which
default to the demo match so a plain `python fetch_match.py` keeps
working unchanged. Fetching a match appends/updates its entry in
`matches.json` rather than replacing the catalog, so multiple matches
can coexist in `app/data/`.

```bash
# discover competition_id/season_id for a competition
../.venv/bin/python -c "from statsbombpy import sb; print(sb.competitions())"

# list match_ids for a competition/season
../.venv/bin/python scripts/fetch_match.py --competition-id 43 --season-id 3 --list-matches

# fetch a specific match
../.venv/bin/python scripts/fetch_match.py --competition-id 43 --season-id 3 --match-id 8658
```

## Run in Docker

```bash
docker compose up --build replay-engine   # from the repo root
```

The image build's fetch stage downloads and derives the data, so the
*running* container never needs network access and doesn't contain
statsbombpy or pandas.
