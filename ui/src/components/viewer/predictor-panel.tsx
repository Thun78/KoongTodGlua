"use client";

import { useCallback, useState } from "react";
import { predictFinal } from "@/lib/heuristics";
import { SHOW_RATIONALE } from "@/lib/match-data";
import { snapshotAt, useMatchStore } from "@/store/match-store";
import { postPredict, type LLMPrediction } from "@/lib/replay-client";

type Mode = "heuristic" | "ai";

export function PredictorPanel() {
  const activeMatch = useMatchStore((s: { activeMatch: any }) => s.activeMatch);
  const snap = useMatchStore((s: { matchSnapshots: any; minute: number }) =>
    snapshotAt(s.matchSnapshots, s.minute),
  );
  const minute = useMatchStore((s: { minute: number }) => s.minute);
  const persona = useMatchStore((s: { persona: string | null }) => s.persona);

  const [mode, setMode] = useState<Mode>("heuristic");
  const [llmPred, setLlmPred] = useState<LLMPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestAiPrediction = useCallback(async () => {
    if (!activeMatch || !snap) return;
    setLoading(true);
    setError(null);
    try {
      const result = await postPredict(
        activeMatch.match_id,
        Math.round(minute),
        persona ?? "bettor",
      );
      setLlmPred(result);
      setMode("ai");
    } catch (e: any) {
      setError(e.message ?? "Prediction failed");
    } finally {
      setLoading(false);
    }
  }, [activeMatch, snap, minute, persona]);

  if (!snap || !activeMatch) return null;

  const pred = predictFinal(snap);
  const homeAbbr = activeMatch.home_team.slice(0, 3).toUpperCase();
  const awayAbbr = activeMatch.away_team.slice(0, 3).toUpperCase();

  // Determine displayed values based on mode
  const isAi = mode === "ai" && llmPred !== null;
  const displayScore = isAi
    ? `${llmPred.predicted_final_score.home} – ${llmPred.predicted_final_score.away}`
    : pred.score;
  const displayCorners = isAi
    ? llmPred.predicted_final_corners.home + llmPred.predicted_final_corners.away
    : pred.corners;
  const displayCards = isAi
    ? llmPred.predicted_final_yellow_cards.home +
      llmPred.predicted_final_yellow_cards.away
    : pred.cards;
  const displayPossA = isAi
    ? llmPred.predicted_final_possession.home
    : pred.possA;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="font-condensed text-[17px] font-bold tracking-[0.08em] text-accent-soft uppercase">
          Predicted final
        </div>
        <div className="flex items-center gap-2">
          <div className="font-mono text-[10px] text-muted">
            {isAi ? `AI · ${persona ?? "bettor"}` : "heuristic · live"}
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1.5">
        <button
          onClick={() => setMode("heuristic")}
          className={`flex-1 rounded-md px-3 py-1.5 font-mono text-[10px] font-bold tracking-wider uppercase transition-all duration-200 ${
            mode === "heuristic"
              ? "bg-accent text-ink shadow-sm"
              : "bg-ink-2 text-muted hover:bg-ink-3 hover:text-tan"
          }`}
        >
          Heuristic
        </button>
        <button
          onClick={requestAiPrediction}
          disabled={loading}
          className={`flex-1 rounded-md px-3 py-1.5 font-mono text-[10px] font-bold tracking-wider uppercase transition-all duration-200 ${
            mode === "ai"
              ? "bg-accent text-ink shadow-sm"
              : "bg-ink-2 text-muted hover:bg-ink-3 hover:text-tan"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {loading ? (
            <span className="inline-flex items-center gap-1.5">
              <svg
                className="h-3 w-3 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Predicting…
            </span>
          ) : (
            "AI Predict"
          )}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-md bg-red-900/30 px-3 py-2 font-mono text-[10px] text-red-400">
          {error}
        </div>
      )}

      {/* Prediction card */}
      <div className="flex flex-col gap-3 rounded-[10px] border border-ink-3 bg-ink-2 p-4">
        <div className="flex items-baseline justify-center gap-3.5">
          <span className="font-condensed text-[15px] font-bold text-tan uppercase">
            {homeAbbr}
          </span>
          <span className="font-condensed text-[42px] leading-none font-extrabold text-cream">
            {displayScore}
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
              {displayCorners}
            </div>
          </div>
          <div className="rounded-[7px] bg-ink px-[11px] py-[9px]">
            <div className="font-mono text-[9.5px] tracking-[0.08em] text-muted">
              CARDS
            </div>
            <div className="font-condensed text-[22px] font-bold">
              {displayCards}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex justify-between font-mono text-[9.5px] tracking-[0.08em] text-muted">
            <span>
              POSSESSION · {homeAbbr} {displayPossA}%
            </span>
            <span>
              {awayAbbr} {100 - displayPossA}%
            </span>
          </div>
          <div className="flex h-[7px] overflow-hidden rounded bg-ink-4">
            <div
              className="bg-accent transition-[width] duration-800 ease-in-out"
              style={{ width: `${displayPossA}%` }}
            />
          </div>
        </div>

        {/* Curated panels (AI mode only) */}
        {isAi && llmPred.curated_panels.length > 0 && (
          <div className="border-t border-ink-3 pt-2.5">
            <div className="mb-1.5 font-mono text-[9px] tracking-[0.1em] text-muted uppercase">
              AI-curated highlights
            </div>
            <div className="flex flex-wrap gap-1.5">
              {llmPred.curated_panels.map((panel, i) => (
                <span
                  key={i}
                  className="rounded-full bg-accent/15 px-2.5 py-0.5 font-mono text-[9.5px] text-accent"
                >
                  {panel}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Rationale (heuristic mode) */}
        {!isAi && SHOW_RATIONALE && (
          <div className="border-t border-ink-3 pt-2.5 text-xs leading-normal text-tan italic">
            &ldquo;{pred.rationale}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}

