"use client";

import { useCallback, useRef } from "react";
import { Chip } from "@/components/ui/chip";
import { EVENTS, SPEEDS } from "@/lib/match-data";
import { useMatchStore } from "@/store/match-store";

export function Timeline() {
  const minute = useMatchStore((s) => s.minute);
  const speed = useMatchStore((s) => s.speed);
  const setSpeed = useMatchStore((s) => s.setSpeed);
  const seek = useMatchStore((s) => s.seek);
  const jumpToEvent = useMatchStore((s) => s.jumpToEvent);

  const trackRef = useRef<HTMLDivElement>(null);
  const progressPct = ((minute / 90) * 100).toFixed(1) + "%";

  // Click-or-drag seeking anywhere on the track, ported from the design's
  // scrubStart: seek on pointerdown, then follow pointermove until release.
  const scrubStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const seekAt = (clientX: number) => {
        const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        seek(frac * 90);
      };
      seekAt(e.clientX);
      const move = (ev: PointerEvent) => seekAt(ev.clientX);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [seek],
  );

  return (
    <div className="flex flex-none flex-col gap-2.5 rounded-xl border-2 border-ink bg-card px-[18px] pt-3.5 pb-3">
      <div
        ref={trackRef}
        onPointerDown={scrubStart}
        className="relative h-[26px] cursor-pointer touch-none"
      >
        <div className="absolute top-[11px] right-0 left-0 h-1 rounded-sm bg-track" />
        <div
          className="absolute top-[11px] left-0 h-1 rounded-sm bg-accent"
          style={{ width: progressPct }}
        />
        <div
          className="pointer-events-none absolute top-1.5 z-1 -ml-[7px] size-3.5 rounded-full border-[3px] border-accent bg-cream shadow-[0_1px_3px_rgba(42,41,37,0.35)]"
          style={{ left: progressPct }}
        />
        {EVENTS.map((ev) => (
          <button
            key={`${ev.min}-${ev.label}`}
            type="button"
            title={ev.label}
            onClick={() => jumpToEvent(ev)}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-1 z-2 -ml-[9px] flex size-[18px] cursor-pointer items-center justify-center rounded-full border-2 border-ink text-[9px] font-bold text-cream transition-transform hover:scale-135"
            style={{
              left: ((ev.min / 90) * 100).toFixed(1) + "%",
              background: ev.color,
            }}
          >
            {ev.glyph}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="font-mono text-[10.5px] tracking-[0.05em] text-muted">
          timeline · click or drag anywhere to seek · ● goal opens 3D replay
        </div>
        <div className="flex gap-1.5">
          {SPEEDS.map((v) => (
            <Chip
              key={v}
              tone="paper"
              selected={v === speed}
              onClick={() => setSpeed(v)}
            >
              {v}×
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
