"use client";

import { Chip } from "@/components/ui/chip";
import { CAMERAS } from "@/lib/match-data";
import { useMatchStore } from "@/store/match-store";

// Fullscreen 3D moment replay. The striped viewport is the seam where the
// Three.js reconstruction (orbitable low-poly scene from tracked broadcast
// footage) plugs in. Track files come from the offline CV pipeline and
// will be referenced from the backend timeline when that work lands.
export function ReplayOverlay() {
  const replayEvent = useMatchStore((s) => s.replayEvent);
  const camera = useMatchStore((s) => s.camera);
  const slow = useMatchStore((s) => s.slow);
  const closeReplay = useMatchStore((s) => s.closeReplay);
  const setCamera = useMatchStore((s) => s.setCamera);
  const toggleSlow = useMatchStore((s) => s.toggleSlow);

  if (!replayEvent) return null;

  const cameraName = CAMERAS.find((c) => c.id === camera)?.label;

  return (
    <div className="fixed inset-0 z-50 flex animate-replay-in flex-col bg-night/96 text-cream">
      <div className="flex items-center justify-between px-7 py-4">
        <div className="flex items-center gap-3.5">
          <span className="rounded bg-accent px-2.5 py-[5px] font-mono text-[10px] tracking-[0.12em]">
            3D MOMENT REPLAY
          </span>
          <div className="font-condensed text-2xl font-bold tracking-[0.04em] uppercase">
            {replayEvent.label} · {replayEvent.display_min}&apos;
          </div>
        </div>
        <button
          type="button"
          onClick={closeReplay}
          className="cursor-pointer rounded-md border-[1.5px] border-muted-3 px-[18px] py-[7px] font-condensed text-base font-bold tracking-[0.08em] uppercase hover:border-accent hover:text-accent-soft"
        >
          ← Back to match
        </button>
      </div>

      <div className="relative mx-7 flex flex-1 items-center justify-center overflow-hidden rounded-[14px] border-2 border-ink-3 bg-[repeating-linear-gradient(-45deg,#232220_0px,#232220_26px,#2a2925_26px,#2a2925_52px)]">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="font-mono text-sm tracking-[0.08em] text-tan">
            [ three.js 3d reconstruction viewport ]
          </div>
          <div className="max-w-[440px] font-mono text-[11.5px] leading-[1.8] text-muted-3">
            Orbitable low-poly scene from tracked broadcast footage.
            <br />
            Drag to orbit · scroll to zoom · camera view:{" "}
            <span className="text-accent-soft">{cameraName}</span>
            {slow ? " · slow-mo ON" : ""}
          </div>
        </div>
        <div className="absolute top-4 left-5 font-mono text-[10px] tracking-[0.08em] text-muted-3">
          tracks: —
        </div>
      </div>

      <div className="flex items-center justify-center gap-2.5 px-7 pt-5 pb-[26px]">
        {CAMERAS.map((cam) => (
          <Chip
            key={cam.id}
            tone="night"
            selected={cam.id === camera}
            onClick={() => setCamera(cam.id)}
          >
            {cam.label}
          </Chip>
        ))}
        <div className="mx-2 h-[26px] w-px bg-ink-3" />
        <Chip tone="night" selected={slow} onClick={toggleSlow}>
          Slow-mo
        </Chip>
      </div>
    </div>
  );
}
