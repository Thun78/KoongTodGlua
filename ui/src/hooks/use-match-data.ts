"use client";

import { useEffect, useState } from "react";
import { getFlow, getSnapshots, getTimeline } from "@/lib/replay-client";
import { useMatchStore } from "@/store/match-store";

/** Loads the active match's snapshots + timeline + flow into the store
 * once. Flow failures degrade to [] (pitch keeps its placeholder) so a
 * match added before the flow feature still plays. */
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
      getFlow(activeMatch.match_id).catch(() => []),
    ])
      .then(([snaps, tl, flow]) => setMatchData(snaps, tl, flow))
      .catch(() =>
        setError("Could not load match data from the replay engine."),
      );
  }, [activeMatch, loaded, setMatchData]);

  return { loading: !loaded && !error, error };
}
