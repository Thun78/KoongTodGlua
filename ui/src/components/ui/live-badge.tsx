import { cn } from "@/lib/utils";

interface LiveBadgeProps {
  label?: string;
  className?: string;
  dotClassName?: string;
}

export function LiveBadge({
  label = "LIVE",
  className,
  dotClassName,
}: LiveBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded bg-accent px-2 py-1 font-mono text-[10px] font-medium tracking-[0.1em] text-cream",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 animate-live-pulse rounded-full bg-cream",
          dotClassName,
        )}
      />
      {label}
    </span>
  );
}
