"use client";

import { useEffect, useState } from "react";
import {
  addMatch,
  deleteMatch,
  getCatalogMatches,
  getClipStatuses,
  getCompetitions,
  getHealth,
  getMatches,
  getTimeline,
  uploadClip,
  type CatalogMatch,
  type ClipStatus,
  type CompetitionSeasons,
  type MatchInfo,
  type TimelineEvent,
} from "@/lib/replay-client";
import { useMatchStore } from "@/store/match-store";

type Phase = "picking" | "submitting" | "clips" | "error";

export function AddMatchScreen() {
  const backHome = useMatchStore((s) => s.backHome);
  const setCatalog = useMatchStore((s) => s.setCatalog);

  const [competitions, setCompetitions] = useState<CompetitionSeasons[] | null>(null);
  const [comp, setComp] = useState<CompetitionSeasons | null>(null);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [matches, setMatches] = useState<CatalogMatch[] | null>(null);
  const [phase, setPhase] = useState<Phase>("picking");
  const [error, setError] = useState<string | null>(null);

  // step 4 (3D reconstruction upload) state
  const [addedMatch, setAddedMatch] = useState<MatchInfo | null>(null);
  const [goals, setGoals] = useState<TimelineEvent[]>([]);
  const [clipStatuses, setClipStatuses] = useState<Record<string, ClipStatus>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [discarding, setDiscarding] = useState(false);

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
      const added = await addMatch(comp.competition_id, seasonId, m.match_id);
      setCatalog(await getMatches());
      const [health, timeline] = await Promise.all([
        getHealth().catch(() => null),
        getTimeline(added.match_id).catch(() => [] as TimelineEvent[]),
      ]);
      const goalEvents = timeline.filter((e) => e.type === "goal");
      if (health?.capabilities.reconstruction_upload && goalEvents.length > 0) {
        setAddedMatch(added);
        setGoals(goalEvents);
        setPhase("clips");
      } else {
        backHome();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed.");
      setPhase("error");
    }
  };

  // poll clip/reconstruction statuses while step 4 is on screen
  useEffect(() => {
    if (phase !== "clips" || !addedMatch) return;
    const tick = () =>
      getClipStatuses(addedMatch.match_id).then(setClipStatuses).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [phase, addedMatch]);

  const onClipPicked = async (ev: TimelineEvent, file: File) => {
    if (!addedMatch) return;
    const key = String(ev.minute);
    setUploading((u) => ({ ...u, [key]: true }));
    setUploadErrors((errs) => ({ ...errs, [key]: "" }));
    try {
      const st = await uploadClip(addedMatch.match_id, ev.minute, file);
      setClipStatuses((s) => ({ ...s, [key]: st }));
    } catch (e) {
      setUploadErrors((errs) => ({
        ...errs,
        [key]: e instanceof Error ? e.message : "upload failed",
      }));
    } finally {
      setUploading((u) => ({ ...u, [key]: false }));
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
      ) : phase === "clips" && addedMatch ? (
        <div className="flex w-full max-w-[720px] animate-fade-up flex-col gap-7">
          <section className="flex flex-col gap-2.5">
            <div className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">
              4 · 3D Reconstruction{" "}
              <span className="text-muted normal-case">(optional)</span>
            </div>
            <p className="text-[13px] leading-normal text-muted-2">
              Attach a short clip of each goal (a few seconds, wide broadcast
              angle works best). The clip will be reconstructed into an animated 3D
              scene on our AMD GPU. Skippable.
            </p>
            <div className="flex flex-col gap-1.5">
              {goals.map((g) => {
                const key = String(g.minute);
                const st = clipStatuses[key];
                const chip = uploading[key]
                  ? "uploading…"
                  : uploadErrors[key]
                    ? `failed: ${uploadErrors[key]}`
                    : st
                      ? st.status === "queued"
                        ? "queued — reconstruction pending"
                        : st.status === "reconstructing"
                          ? "reconstructing ~2min"
                          : st.status === "ready"
                            ? "ready ✓"
                            : `failed: ${st.error ?? "error"}`
                      : "no clip";
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4 rounded-lg border-2 border-ink bg-card px-4 py-2.5"
                  >
                    <span className="font-condensed text-[17px] font-bold">
                      {g.display_min}&apos; · {g.label}
                    </span>
                    <div className="flex items-center gap-3">
                      <span
                        className={`font-mono text-[11px] ${
                          st?.status === "ready" ||
                          uploadErrors[key] ||
                          st?.status === "failed"
                            ? "text-accent"
                            : "text-muted"
                        }`}
                      >
                        {chip}
                      </span>
                      <label className="cursor-pointer rounded-[5px] border-[1.5px] border-sand px-3 py-1.5 font-mono text-[12px] text-muted-2 transition-colors hover:border-accent hover:text-accent">
                        {st || uploading[key] ? "replace clip" : "⬆ add clip"}
                        <input
                          type="file"
                          accept="video/mp4,video/quicktime,video/webm"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) onClipPicked(g, f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={backHome}
              className="cursor-pointer self-center rounded-lg border-2 border-ink bg-ink px-8 py-2.5 font-condensed text-[17px] font-bold tracking-[0.06em] text-cream uppercase transition-colors hover:border-accent hover:bg-accent"
            >
              Done
            </button>
            <button
              type="button"
              disabled={discarding}
              onClick={async () => {
                // leaving without Done discards the match entirely — it
                // was only added (fetched + saved) so this step could
                // show its goals; back-out shouldn't leave it in the catalog
                if (addedMatch) {
                  setDiscarding(true);
                  try {
                    await deleteMatch(addedMatch.match_id);
                  } catch {
                    // engine unreachable — nothing more we can do client-side
                  }
                  setCatalog(await getMatches().catch(() => []));
                }
                setAddedMatch(null);
                setGoals([]);
                setClipStatuses({});
                setUploadErrors({});
                setDiscarding(false);
                setPhase("picking");
              }}
              className="cursor-pointer text-[13px] text-muted underline hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {discarding ? "discarding…" : "← back"}
            </button>
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

      {(phase === "picking" || phase === "error") && (
        <button
          type="button"
          onClick={backHome}
          className="cursor-pointer text-[13px] text-muted underline hover:text-accent"
        >
          ← back
        </button>
      )}
    </div>
  );
}
