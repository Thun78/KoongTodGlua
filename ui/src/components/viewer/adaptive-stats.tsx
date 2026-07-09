"use client";

import { PERSONAS } from "@/lib/match-data";
import { computeStats, computeVisibleStats } from "@/lib/simulation";
import { useMatchStore } from "@/store/match-store";

export function AdaptiveStats() {
  const minute = useMatchStore((s) => s.minute);
  const persona = useMatchStore((s) => s.persona);

  const st = computeStats(minute);
  const vis = persona
    ? computeVisibleStats(persona, st, minute)
    : { list: [], hidden: 0 };
  const personaName = persona ? PERSONAS[persona].name : "you";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="font-condensed text-[17px] font-bold tracking-[0.08em] text-accent-soft uppercase">
          Your stats
        </div>
        <div className="font-mono text-[10px] text-muted">
          curated · {personaName}
        </div>
      </div>

      {vis.list.map((stat) => (
        <div
          key={stat.label}
          className="flex animate-fade-up-fast flex-col gap-[7px] rounded-[10px] border border-ink-3 bg-ink-2 px-3.5 py-3"
        >
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-[10px] tracking-[0.1em] text-muted">
              {stat.label}
            </div>
            {stat.badge && (
              <span className="rounded-[3px] bg-accent/25 px-1.5 py-0.5 font-mono text-[9px] text-accent-soft">
                {stat.badge}
              </span>
            )}
          </div>
          <div className="flex items-baseline justify-between gap-2.5">
            <span className="font-condensed text-2xl leading-none font-bold">
              {stat.arg}
            </span>
            <span className="text-xs text-muted">{stat.mid}</span>
            <span className="font-condensed text-2xl leading-none font-bold text-tan">
              {stat.fra}
            </span>
          </div>
        </div>
      ))}

      <div className="px-1 font-mono text-[10px] leading-[1.7] text-muted-3">
        {vis.hidden} stats hidden by the curator — not relevant to {personaName}{" "}
        right now.
      </div>
    </div>
  );
}
