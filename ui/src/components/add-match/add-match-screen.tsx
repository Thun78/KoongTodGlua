"use client";

import { useEffect, useState } from "react";
import {
  addMatch,
  getCatalogMatches,
  getCompetitions,
  getMatches,
  type CatalogMatch,
  type CompetitionSeasons,
} from "@/lib/replay-client";
import { useMatchStore } from "@/store/match-store";

type Phase = "picking" | "submitting" | "error";

export function AddMatchScreen() {
  const backHome = useMatchStore((s) => s.backHome);
  const setCatalog = useMatchStore((s) => s.setCatalog);

  const [competitions, setCompetitions] = useState<CompetitionSeasons[] | null>(null);
  const [comp, setComp] = useState<CompetitionSeasons | null>(null);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [matches, setMatches] = useState<CatalogMatch[] | null>(null);
  const [phase, setPhase] = useState<Phase>("picking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCompetitions()
      .then(setCompetitions)
      .catch(() => {
        setError("Could not reach the replay engine.");
        setPhase("error");
      });
  }, []);

  useEffect(() => {
    setMatches(null);
    if (comp && seasonId !== null) {
      getCatalogMatches(comp.competition_id, seasonId)
        .then(setMatches)
        .catch(() => {
          setError("Could not load matches.");
          setPhase("error");
        });
    }
  }, [comp, seasonId]);

  const submit = async (m: CatalogMatch) => {
    if (!comp || seasonId === null) return;
    setPhase("submitting");
    setError(null);
    try {
      await addMatch(comp.competition_id, seasonId, m.match_id);
      setCatalog(await getMatches());
      backHome();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed.");
      setPhase("error");
    }
  };

  return (
    <div className="flex flex-1 animate-fade-up flex-col items-center gap-9 overflow-y-auto px-11 py-15">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <h1 className="font-condensed text-[40px] font-extrabold tracking-[0.02em] uppercase">
          Add a game
        </h1>
        <p className="max-w-[460px] text-[15px] leading-normal text-muted-2">
          Any match in StatsBomb open data. Pick a competition, a season, then
          the match — we fetch and derive its stats on the spot.
        </p>
      </div>

      {phase === "submitting" ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="animate-live-pulse font-mono text-[13px] tracking-[0.06em] text-muted">
            fetching events… deriving stats… (~30s)
          </div>
        </div>
      ) : (
        <div className="flex w-full max-w-[720px] flex-col gap-7">
          {error && (
            <div className="rounded-lg border-2 border-accent bg-card px-4 py-3 text-[13px] text-accent">
              {error}{" "}
              <button
                type="button"
                className="cursor-pointer underline"
                onClick={() => {
                  setError(null);
                  setPhase("picking");
                }}
              >
                retry
              </button>
            </div>
          )}

          {/* Step 1: competition */}
          <section className="flex flex-col gap-2.5">
            <div className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">
              1 · Competition
            </div>
            <div className="flex flex-wrap gap-2">
              {(competitions ?? []).map((c) => (
                <button
                  key={c.competition_id}
                  type="button"
                  onClick={() => {
                    setComp(c);
                    setSeasonId(null);
                  }}
                  className={`cursor-pointer rounded-lg border-2 px-4 py-2 font-condensed text-[16px] font-bold tracking-[0.04em] uppercase transition-colors ${
                    comp?.competition_id === c.competition_id
                      ? "border-ink bg-ink text-cream"
                      : "border-sand bg-card hover:border-accent"
                  }`}
                >
                  {c.competition_name}
                </button>
              ))}
              {competitions === null && !error && (
                <span className="font-mono text-[12px] text-muted">
                  loading competitions…
                </span>
              )}
            </div>
          </section>

          {/* Step 2: season — revealed once a competition is chosen */}
          {comp && (
            <section className="flex animate-fade-up flex-col gap-2.5">
              <div className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">
                2 · Season
              </div>
              <div className="flex flex-wrap gap-2">
                {comp.seasons.map((s) => (
                  <button
                    key={s.season_id}
                    type="button"
                    onClick={() => setSeasonId(s.season_id)}
                    className={`cursor-pointer rounded-[5px] border-[1.5px] px-3 py-1.5 font-mono text-[12px] transition-colors ${
                      seasonId === s.season_id
                        ? "border-accent bg-accent text-cream"
                        : "border-sand text-muted-2 hover:border-accent"
                    }`}
                  >
                    {s.season_name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Step 3: match — revealed once a season is chosen */}
          {comp && seasonId !== null && (
            <section className="flex animate-fade-up flex-col gap-2.5">
              <div className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">
                3 · Match
              </div>
              <div className="flex max-h-[340px] flex-col gap-1.5 overflow-y-auto pr-1">
                {(matches ?? []).map((m) => (
                  <button
                    key={m.match_id}
                    type="button"
                    onClick={() => submit(m)}
                    className="flex cursor-pointer items-baseline justify-between gap-4 rounded-lg border-2 border-ink bg-card px-4 py-2.5 text-left transition-colors hover:bg-ink hover:text-cream"
                  >
                    <span className="font-condensed text-[17px] font-bold">
                      {m.home_team} {m.home_score}–{m.away_score} {m.away_team}
                    </span>
                    <span className="font-mono text-[11px] text-muted">
                      {m.date} · {m.stage}
                    </span>
                  </button>
                ))}
                {matches === null && (
                  <span className="font-mono text-[12px] text-muted">
                    loading matches…
                  </span>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={backHome}
        className="cursor-pointer text-[13px] text-muted underline hover:text-accent"
      >
        ← back
      </button>
    </div>
  );
}
