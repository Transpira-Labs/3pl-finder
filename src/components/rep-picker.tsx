"use client";

import { Check, User } from "lucide-react";
import { useTracker } from "./tracker-provider";
import { SOLO_REP_ID } from "@/hooks/useCallTracker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Pick which rep you are (identity for now — swap for real auth later). */
export function RepPicker() {
  const t = useTracker();
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-6">
      <div className="w-full rounded-xl border border-border bg-card p-6 soft-shadow">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
            <User className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-semibold">Who are you?</h2>
            <p className="text-xs text-muted-foreground">
              Pick your rep to receive calls and log your time.
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          {t.reps.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No reps yet — add one on the Dialer Dashboard.
            </p>
          )}
          {t.reps.map((r) => (
            <button
              key={r.id}
              onClick={() => t.setRepId(r.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border border-border px-3 py-2.5 text-left text-sm outline-none transition-[transform,color,background-color] duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98]",
                t.repId === r.id && "border-primary/50 bg-primary/10",
              )}
            >
              <span>
                <span className="font-medium">{r.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{r.phone}</span>
              </span>
              {t.repId === r.id && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
        </div>

        {/* Solo: use the console without a rep or the dialer — saved locally. */}
        <div className="mt-4 border-t border-border pt-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => t.setRepId(SOLO_REP_ID)}
          >
            Use without a rep (solo mode)
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Track calls on this device only — no dialer, saved to this browser and
            optionally your Google Sheet.
          </p>
        </div>
      </div>
    </div>
  );
}
