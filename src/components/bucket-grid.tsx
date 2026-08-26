"use client";

import { useTracker } from "./tracker-provider";
import { BUCKETS } from "@/lib/config";
import { fmtMs } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Six state toggles (dialing/ringing, waiting, right/wrong person, voicemail, no
 * answer). One active at a time; click or press its number. `compact` is the tight
 * variant used in the floating dock.
 */
export function BucketGrid({ compact = false }: { compact?: boolean }) {
  const t = useTracker();
  return (
    <div className={cn("grid grid-cols-2 gap-2", !compact && "sm:grid-cols-3", compact && "gap-1.5")}>
      {BUCKETS.map((b) => {
        const active = t.active === b.id;
        return (
          <button
            key={b.id}
            onClick={() => t.toggleBucket(b.id)}
            title={b.sub}
            style={
              active
                ? {
                    borderColor: `${b.color}55`,
                    background: `${b.color}14`,
                    boxShadow: `inset 0 0 0 1px ${b.color}55`,
                  }
                : undefined
            }
            className={cn(
              "flex flex-col rounded-lg border border-border bg-card text-left outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98]",
              compact ? "gap-0.5 px-2 py-1.5" : "gap-1 px-3 py-2.5",
              !active && "hover:bg-muted",
            )}
          >
            <span className={cn("flex items-center", compact ? "gap-1.5" : "gap-2")}>
              <kbd
                style={active ? { color: b.color, borderColor: b.color } : undefined}
                className={cn(
                  "rounded border border-border bg-muted font-mono leading-none text-muted-foreground",
                  compact ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-[11px]",
                )}
              >
                {b.key}
              </kbd>
              <span
                className={cn(
                  "font-semibold text-foreground",
                  compact ? "text-xs" : "text-sm",
                )}
              >
                {b.short}
              </span>
              {active && (
                <span
                  className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
                  style={{ background: b.color }}
                />
              )}
            </span>
            <span
              style={active ? { color: b.color } : undefined}
              className={cn(
                "font-mono tabular-nums text-muted-foreground",
                compact ? "text-[10px]" : "text-sm",
              )}
            >
              {fmtMs(t.bucketMs(b.id))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
