"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

// Toggle chip used for playback speeds (paper tone) and replay camera
// presets / slow-mo (night tone). Selected state fills with the accent.
const chipVariants = cva("cursor-pointer border-[1.5px] transition-colors hover:border-accent", {
  variants: {
    tone: {
      paper: "rounded-[5px] px-[9px] py-[3px] font-mono text-[11px]",
      night:
        "rounded-lg px-5 py-[9px] font-condensed text-[15px] font-bold uppercase tracking-[0.07em]",
    },
    selected: {
      true: "border-accent bg-accent text-cream",
      false: "bg-transparent",
    },
  },
  compoundVariants: [
    { tone: "paper", selected: false, className: "border-sand text-muted" },
    { tone: "night", selected: false, className: "border-ink-3 text-tan" },
  ],
  defaultVariants: { tone: "paper", selected: false },
});

interface ChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chipVariants> {}

export function Chip({ className, tone, selected, ...props }: ChipProps) {
  return (
    <button
      type="button"
      className={cn(chipVariants({ tone, selected }), className)}
      {...props}
    />
  );
}
