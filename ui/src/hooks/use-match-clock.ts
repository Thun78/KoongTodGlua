"use client";

import { useEffect } from "react";
import { useMatchStore } from "@/store/match-store";

/** Drives the match clock: one store tick every 500ms while mounted. */
export function useMatchClock() {
  useEffect(() => {
    const timer = setInterval(() => useMatchStore.getState().tick(), 500);
    return () => clearInterval(timer);
  }, []);
}
