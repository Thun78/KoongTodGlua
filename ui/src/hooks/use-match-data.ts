"use client";

import { useEffect, useState } from "react";
import { getSnapshots, getTimeline } from "@/lib/replay-client";
import { useMatchStore } from "@/store/match-store";

/** Loads the active match's snapshots + timeline into the store once. */
export function useMatchData() {
  const activeMatch = useMatchStore((s) => s.activeMatch);
  const loaded = useMatchStore((s) => s.matchSnapshots.length > 0);
  const setMatchData = useMatchStore((s) => s.setMatchData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeMatch || loaded) return;
    Promise.all([
      getSnapshots(activeMatch.match_id),
      getTimeline(activeMatch.match_id),
    ])
      .then(([snaps, tl]) => setMatchData(snaps, tl))
      .catch(() =>
        setError("Could not load match data from the replay engine."),
      );
  }, [activeMatch, loaded, setMatchData]);

  return { loading: !loaded && !error, error };
}
