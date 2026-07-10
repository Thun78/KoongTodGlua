"use client";

import { snapshotAt, useMatchStore } from "@/store/match-store";

export function ScoreBug() {
  const minute = useMatchStore((s) => s.minute);
  const playing = useMatchStore((s) => s.playing);
  const activeMatch = useMatchStore((s) => s.activeMatch);
  const snap = useMatchStore((s) => snapshotAt(s.matchSnapshots, s.minute));

  if (!snap || !activeMatch) return null;

  const clock =
    String(Math.floor(minute)).padStart(2, "0") +
    "'" +
    (playing ? "" : " · paused");

  return (
    <div className="relative flex items-center justify-center gap-[26px] rounded-xl bg-ink px-7 py-4 text-cream">
      <div className="flex-1 text-right font-condensed text-[26px] font-bold tracking-[0.06em] uppercase">
        {activeMatch.home_team}
      </div>
      {/* clock is out of flow (pinned in the bar's bottom padding) so the
          score box itself is what vertically centers */}
      <div className="rounded-lg bg-accent px-[18px] py-1 font-condensed text-[44px] leading-none font-extrabold tracking-[0.04em]">
        {snap.score[0]} – {snap.score[1]}
      </div>
      <div className="absolute bottom-[3px] left-1/2 -translate-x-1/2 font-mono text-[12px] leading-none whitespace-nowrap text-accent-soft">
        {clock}
      </div>
      <div className="flex-1 font-condensed text-[26px] font-bold tracking-[0.06em] uppercase">
        {activeMatch.away_team}
      </div>
    </div>
  );
}
