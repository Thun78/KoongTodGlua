"use client";

import { predictFinal } from "@/lib/heuristics";
import { SHOW_RATIONALE } from "@/lib/match-data";
import { snapshotAt, useMatchStore } from "@/store/match-store";

export function PredictorPanel() {
  const activeMatch = useMatchStore((s) => s.activeMatch);
  const snap = useMatchStore((s) => snapshotAt(s.matchSnapshots, s.minute));

  if (!snap || !activeMatch) return null;

  const pred = predictFinal(snap);
  const homeAbbr = activeMatch.home_team.slice(0, 3).toUpperCase();
  const awayAbbr = activeMatch.away_team.slice(0, 3).toUpperCase();

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="font-condensed text-[17px] font-bold tracking-[0.08em] text-accent-soft uppercase">
          Predicted final
        </div>
        <div className="font-mono text-[10px] text-muted">heuristic · live</div>
      </div>

      <div className="flex flex-col gap-3 rounded-[10px] border border-ink-3 bg-ink-2 p-4">
        <div className="flex items-baseline justify-center gap-3.5">
          <span className="font-condensed text-[15px] font-bold text-tan uppercase">
            {homeAbbr}
          </span>
          <span className="font-condensed text-[42px] leading-none font-extrabold text-cream">
            {pred.score}
          </span>
          <span className="font-condensed text-[15px] font-bold text-tan uppercase">
            {awayAbbr}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[7px] bg-ink px-[11px] py-[9px]">
            <div className="font-mono text-[9.5px] tracking-[0.08em] text-muted">
              CORNERS
            </div>
            <div className="font-condensed text-[22px] font-bold">
              {pred.corners}
            </div>
          </div>
          <div className="rounded-[7px] bg-ink px-[11px] py-[9px]">
            <div className="font-mono text-[9.5px] tracking-[0.08em] text-muted">
              CARDS
            </div>
            <div className="font-condensed text-[22px] font-bold">
              {pred.cards}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex justify-between font-mono text-[9.5px] tracking-[0.08em] text-muted">
            <span>
              POSSESSION · {homeAbbr} {pred.possA}%
            </span>
            <span>
              {awayAbbr} {100 - pred.possA}%
            </span>
          </div>
          <div className="flex h-[7px] overflow-hidden rounded bg-ink-4">
            <div
              className="bg-accent transition-[width] duration-800 ease-in-out"
              style={{ width: `${pred.possA}%` }}
            />
          </div>
        </div>

        {SHOW_RATIONALE && (
          <div className="border-t border-ink-3 pt-2.5 text-xs leading-normal text-tan italic">
            “{pred.rationale}”
          </div>
        )}
      </div>
    </div>
  );
}
