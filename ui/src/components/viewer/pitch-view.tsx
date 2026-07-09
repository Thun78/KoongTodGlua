"use client";

import { snapshotAt, useMatchStore } from "@/store/match-store";

// Placeholder for the live pitch render — the seam where the replay
// engine's 2D view / broadcast frame plugs in.
export function PitchView() {
  const activeMatch = useMatchStore((s) => s.activeMatch);
  const snap = useMatchStore((s) => snapshotAt(s.matchSnapshots, s.minute));

  if (!snap || !activeMatch) return null;

  const homeAbbr = activeMatch.home_team.slice(0, 3).toUpperCase();
  const awayAbbr = activeMatch.away_team.slice(0, 3).toUpperCase();

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border-2 border-ink bg-[repeating-linear-gradient(45deg,#efe5d2_0px,#efe5d2_22px,#e7dac2_22px,#e7dac2_44px)]">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="font-mono text-[13px] tracking-[0.06em] text-muted">
          [ live pitch view ]
        </div>
        <div className="max-w-[380px] font-mono text-[11px] leading-[1.7] text-sand-2">
          2D match render / broadcast frame goes here.
          <br />
          Driven by the replay engine.
        </div>
      </div>

      {/* momentum strip on pitch */}
      <div className="absolute right-4 bottom-3.5 left-4 flex flex-col gap-[5px]">
        <div className="flex justify-between font-mono text-[10px] tracking-[0.08em] text-muted">
          <span>MOMENTUM · {homeAbbr}</span>
          <span>{awayAbbr}</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded bg-track-2">
          <div
            className="bg-accent transition-[width] duration-800 ease-in-out"
            style={{ width: `${Math.round(snap.momentum * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
