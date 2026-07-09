"use client";

import { HomeScreen } from "@/components/home/home-screen";
import { PersonaScreen } from "@/components/persona/persona-screen";
import { ViewerScreen } from "@/components/viewer/viewer-screen";
import { useMatchStore } from "@/store/match-store";

export default function AdaptiveMatchPage() {
  const screen = useMatchStore((s) => s.screen);

  return (
    <div className="flex min-h-screen flex-col">
      {screen === "home" && <HomeScreen />}
      {screen === "persona" && <PersonaScreen />}
      {screen === "viewer" && <ViewerScreen />}
    </div>
  );
}
