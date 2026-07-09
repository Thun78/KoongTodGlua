"use client";

import { PERSONA_IDS, PERSONAS } from "@/lib/match-data";
import { useMatchStore } from "@/store/match-store";

export function PersonaScreen() {
  const pickPersona = useMatchStore((s) => s.pickPersona);
  const backHome = useMatchStore((s) => s.backHome);

  return (
    <div className="flex flex-1 animate-fade-up flex-col items-center justify-center gap-9 px-11 py-15">
      <div className="flex flex-col items-center gap-2.5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-[72px] w-auto" />
        <h1 className="font-condensed text-[40px] font-extrabold tracking-[0.02em] uppercase">
          How do you watch?
        </h1>
        <p className="max-w-[460px] text-[15px] leading-normal text-muted-2">
          Your pick shapes which live stats get shown during play. Change it
          anytime from settings.
        </p>
      </div>

      <div className="grid grid-cols-[repeat(3,250px)] gap-[18px]">
        {PERSONA_IDS.map((id) => {
          const p = PERSONAS[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => pickPersona(id)}
              className="group flex min-h-[220px] cursor-pointer flex-col gap-3 rounded-[14px] border-2 border-ink bg-card px-6 py-[26px] text-left transition-[background-color,color,transform,box-shadow] hover:-translate-y-[3px] hover:bg-ink hover:text-cream hover:shadow-[0_8px_0_#c8492a]"
            >
              <div className="font-mono text-[11px] tracking-[0.1em] text-accent">
                {p.tag}
              </div>
              <div className="font-condensed text-[28px] font-bold tracking-[0.03em] uppercase">
                {p.name}
              </div>
              <div className="text-[13.5px] leading-normal opacity-75">
                {p.desc}
              </div>
              <div className="mt-auto font-mono text-[11px] leading-[1.6] opacity-60">
                {p.statsHint}
              </div>
            </button>
          );
        })}
      </div>

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
