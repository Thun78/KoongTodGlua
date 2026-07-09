"use client";

import { LiveBadge } from "@/components/ui/live-badge";
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

export function HomeScreen() {
  const enterMatch = useMatchStore((s) => s.enterMatch);

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
        <div className="font-mono text-xs text-muted">prototype · ui/ux pass</div>
      </header>

      <main className="flex flex-1 flex-col items-center gap-10 px-11 pt-14 pb-18">
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
              catalog TBD — demo match only
            </div>
          </div>

          <button
            type="button"
            onClick={enterMatch}
            className="flex cursor-pointer items-center justify-between gap-5 rounded-xl border-2 border-ink bg-ink px-[30px] py-[26px] text-left text-cream transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_8px_0_rgba(200,73,42,0.9)]"
          >
            <div className="flex items-center gap-[18px]">
              <LiveBadge
                label="REPLAY-AS-LIVE"
                className="gap-[7px] rounded px-2.5 py-[5px] text-[11px]"
                dotClassName="size-[7px]"
              />
              <div>
                <div className="font-condensed text-[28px] font-bold tracking-[0.02em]">
                  Argentina vs France
                </div>
                <div className="mt-0.5 text-[13px] text-tan">
                  FIFA World Cup Final 2022 · demo match · StatsBomb events
                </div>
              </div>
            </div>
            <div className="font-condensed text-lg font-bold tracking-[0.08em] text-accent-soft uppercase">
              Watch →
            </div>
          </button>

          <div className="grid grid-cols-2 gap-3.5">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="flex flex-col gap-1 rounded-xl border-2 border-dashed border-sand px-7 py-6 text-sand-2"
              >
                <div className="font-mono text-[11px] tracking-[0.08em]">
                  [ match slot ]
                </div>
                <div className="text-[13px]">
                  Further matches populated by backend
                </div>
              </div>
            ))}
          </div>
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
