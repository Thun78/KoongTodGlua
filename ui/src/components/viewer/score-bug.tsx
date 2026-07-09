"use client";

import { computeStats } from "@/lib/simulation";
import { useMatchStore } from "@/store/match-store";

export function ScoreBug() {
  const minute = useMatchStore((s) => s.minute);
  const playing = useMatchStore((s) => s.playing);
  const st = computeStats(minute);

  const clock =
    String(Math.floor(minute)).padStart(2, "0") +
    "'" +
    (playing ? "" : " · paused");

  return (
    <div className="flex items-center justify-center gap-[26px] rounded-xl bg-ink px-7 py-3.5 text-cream">
      <div className="flex-1 text-right font-condensed text-[26px] font-bold tracking-[0.06em] uppercase">
        Argentina
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <div className="rounded-lg bg-accent px-[18px] py-1 font-condensed text-[44px] leading-none font-extrabold tracking-[0.04em]">
          {st.goalsA} – {st.goalsF}
        </div>
        <div className="font-mono text-[13px] text-accent-soft">{clock}</div>
      </div>
      <div className="flex-1 font-condensed text-[26px] font-bold tracking-[0.06em] uppercase">
        France
      </div>
    </div>
  );
}
