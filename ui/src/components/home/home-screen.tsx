"use client";

import { useEffect, useState } from "react";
import { LiveBadge } from "@/components/ui/live-badge";
import { deleteMatch, getMatches, type MatchInfo } from "@/lib/replay-client";
import { useMatchStore } from "@/store/match-store";

const FEATURES = [
  {
    title: "Predictor",
    desc: "Gemma 4 forecasts the final score, corners, cards and possession — live.",
  },
  {
    title: "Adaptive stats",
    desc: "Only the stats that matter to you, right now. The rest stay hidden.",
  },
  {
    title: "3D moments",
    desc: "Goals and red cards become orbitable 3D scenes built from real footage.",
  },
];

// Shown when replay-engine is unreachable so the home screen never dies;
// watching still requires the engine.
const DEMO_FALLBACK: MatchInfo = {
  match_id: 3869685,
  home_team: "Argentina",
  away_team: "France",
  label: "FIFA World Cup · 2022 · Final",
  date: "2022-12-18",
  regulation_score: [2, 2],
};

export function HomeScreen() {
  const enterMatch = useMatchStore((s) => s.enterMatch);
  const openAddMatch = useMatchStore((s) => s.openAddMatch);
  const catalog = useMatchStore((s) => s.catalog);
  const catalogOffline = useMatchStore((s) => s.catalogOffline);
  const setCatalog = useMatchStore((s) => s.setCatalog);

  // two-click delete: first click arms the confirm, second click deletes
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (catalog !== null) return;
    getMatches()
      .then((m) => setCatalog(m))
      .catch(() => setCatalog([DEMO_FALLBACK], true));
  }, [catalog, setCatalog]);

  const onDelete = async (matchId: number) => {
    if (confirmDeleteId !== matchId) {
      setConfirmDeleteId(matchId);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteMatch(matchId);
      setCatalog(await getMatches());
    } catch {
      // engine unreachable — leave the catalog as-is
    }
  };

  return (
    <div className="flex flex-1 animate-fade-up flex-col">
      <header className="flex items-center justify-between border-b-2 border-ink px-11 py-5">
        <div className="flex items-center gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Koong Tod Glua" className="h-[52px] w-auto" />
          <div>
            <div className="font-condensed text-2xl leading-none font-extrabold tracking-[0.04em] uppercase">
              AdaptiveMatch AI
            </div>
            <div className="mt-[3px] text-xs tracking-[0.08em] text-muted uppercase">
              Koong Tod Glua · Match Viewer
            </div>
          </div>
        </div>
        <div className="font-mono text-xs text-muted">prototype</div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-10 px-11 py-14">
        <div className="flex max-w-[640px] flex-col gap-3 text-center">
          <h1 className="font-condensed text-[54px] leading-[1.02] font-extrabold tracking-[0.01em] uppercase">
            Watch the match,
            <br />
            not the dashboard.
          </h1>
          <p className="text-[17px] leading-normal text-muted-2">
            Live predictions of the final stats, a stat display that adapts to
            who you are, and orbitable 3D replays of the big moments.
          </p>
        </div>

        {/* Match selection */}
        <div className="flex w-full max-w-[880px] flex-col gap-3.5">
          <div className="flex items-baseline justify-between">
            <div className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">
              Matches
            </div>
            <div className="font-mono text-[11px] text-muted">
              {catalogOffline
                ? "replay engine offline — demo only"
                : catalog === null
                  ? "loading catalog…"
                  : `${catalog.length} match(es) · statsbomb open data`}
            </div>
          </div>

          {(catalog ?? []).map((m) => (
            <div key={m.match_id} className="relative">
              <button
                type="button"
                onClick={() => enterMatch(m)}
                className="flex w-full cursor-pointer items-center justify-between gap-5 rounded-xl border-2 border-ink bg-ink px-[30px] py-[26px] text-left text-cream transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_8px_0_rgba(200,73,42,0.9)]"
              >
                <div className="flex items-center gap-[18px]">
                  <LiveBadge
                    label="REPLAY"
                    className="gap-[7px] rounded px-2.5 py-[5px] text-[11px]"
                    dotClassName="size-[7px]"
                  />
                  <div>
                    <div className="font-condensed text-[28px] font-bold tracking-[0.02em]">
                      {m.home_team} vs {m.away_team}
                    </div>
                    <div className="mt-0.5 text-[13px] text-tan">
                      {m.label} · {m.date} · StatsBomb events
                    </div>
                  </div>
                </div>
                <div className="pr-8 font-condensed text-lg font-bold tracking-[0.08em] text-accent-soft uppercase">
                  Watch →
                </div>
              </button>
              <button
                type="button"
                title={
                  confirmDeleteId === m.match_id
                    ? "Click again to delete this replay"
                    : "Delete this replay"
                }
                onClick={() => onDelete(m.match_id)}
                onMouseLeave={() =>
                  confirmDeleteId === m.match_id && setConfirmDeleteId(null)
                }
                className={`absolute top-2 right-2 flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] tracking-[0.08em] transition-colors ${
                  confirmDeleteId === m.match_id
                    ? "border-accent bg-accent text-cream"
                    : "border-muted-3 text-muted hover:border-accent hover:text-accent-soft"
                }`}
              >
                {confirmDeleteId === m.match_id ? "confirm ✕" : "✕"}
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={openAddMatch}
            className="flex cursor-pointer flex-col gap-1 rounded-xl border-2 border-dashed border-sand px-7 py-6 text-left text-sand-2 transition-colors hover:border-accent hover:text-accent"
          >
            <div className="font-mono text-[11px] tracking-[0.08em]">
              [ + add game ]
            </div>
            <div className="text-[13px]">
              Pick any match from StatsBomb open data
            </div>
          </button>
        </div>

        {/* Feature strip */}
        <div className="grid w-full max-w-[880px] grid-cols-3 gap-3.5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="flex flex-col gap-[5px] rounded-[10px] bg-panel px-5 py-[18px]"
            >
              <div className="font-condensed text-[17px] font-bold tracking-[0.05em] text-accent uppercase">
                {f.title}
              </div>
              <div className="text-[13px] leading-[1.45] text-muted-2">
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
