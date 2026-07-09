"use client";

import { AdaptiveStats } from "@/components/viewer/adaptive-stats";
import { PitchView } from "@/components/viewer/pitch-view";
import { PredictorPanel } from "@/components/viewer/predictor-panel";
import { ReplayOverlay } from "@/components/replay/replay-overlay";
import { ScoreBug } from "@/components/viewer/score-bug";
import { Timeline } from "@/components/viewer/timeline";
import { LiveBadge } from "@/components/ui/live-badge";
import { useMatchClock } from "@/hooks/use-match-clock";
import { useMatchData } from "@/hooks/use-match-data";
import { PERSONAS } from "@/lib/match-data";
import { useMatchStore } from "@/store/match-store";

export function ViewerScreen() {
  useMatchClock();
  const { loading, error } = useMatchData();

  const activeMatch = useMatchStore((s) => s.activeMatch);
  const persona = useMatchStore((s) => s.persona);
  const playing = useMatchStore((s) => s.playing);
  const replayEvent = useMatchStore((s) => s.replayEvent);
  const backHome = useMatchStore((s) => s.backHome);
  const togglePlay = useMatchStore((s) => s.togglePlay);
  const openSettings = useMatchStore((s) => s.openSettings);

  const personaName = persona ? PERSONAS[persona].name : "—";

  return (
    <div className="flex h-screen animate-fade-up-fast flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex flex-none items-center justify-between gap-5 bg-ink px-5 py-5 text-cream">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={backHome}
            className="flex cursor-pointer items-center hover:opacity-70"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Home" className="h-[52px] w-auto" />
          </button>
          <div className="font-condensed text-lg font-bold tracking-[0.05em] uppercase">
            {activeMatch?.label ?? "Match"}
          </div>
          <LiveBadge />
        </div>
        <div className="flex items-center gap-3.5">
          <div className="font-mono text-xs text-tan">
            persona · <span className="text-accent-soft">{personaName}</span>
          </div>
          <button
            type="button"
            onClick={togglePlay}
            className="cursor-pointer rounded-md border-[1.5px] border-muted-3 px-3.5 py-[5px] font-condensed text-[15px] font-bold tracking-[0.08em] uppercase hover:border-cream"
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button
            type="button"
            onClick={openSettings}
            className="cursor-pointer rounded-md border-[1.5px] border-muted-3 px-3.5 py-[5px] font-condensed text-[15px] font-bold tracking-[0.08em] uppercase hover:border-cream"
          >
            Settings
          </button>
        </div>
      </header>

      {loading || error ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="font-mono text-[13px] tracking-[0.06em] text-muted">
            {error ?? "loading match data…"}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 p-[18px]">
            <ScoreBug />
            <PitchView />
            <Timeline />
          </div>

          <aside className="flex min-h-0 flex-none basis-[420px] flex-col gap-4 overflow-y-auto bg-ink px-[18px] pt-[18px] pb-6 text-cream">
            <PredictorPanel />
            <AdaptiveStats />
          </aside>
        </div>
      )}

      {replayEvent && <ReplayOverlay />}
    </div>
  );
}
