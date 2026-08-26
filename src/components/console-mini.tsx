"use client";

import Link from "next/link";
import { PhoneOff, UserRound, ExternalLink, Phone } from "lucide-react";
import { useTracker } from "@/components/tracker-provider";
import { RepPicker } from "@/components/rep-picker";
import { Softphone } from "@/components/softphone";
import { LeadCard } from "@/components/lead-card";
import { BucketGrid } from "@/components/bucket-grid";
import { Button } from "@/components/ui/button";
import { fmtMs } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Minimal call console for the floating dock: pick a rep, then just the softphone,
 * who's on the line, a big running timer, and End call & save (Enter). The bucket
 * tracking, stats, history, and sheet sync live on the full /console page.
 */
export function ConsoleMini() {
  const t = useTracker();

  if (!t.repId)
    return (
      <div className="p-4">
        <RepPicker />
      </div>
    );

  const onCall = t.active !== "idle";
  const solo = t.solo;
  const available = t.currentRep?.presence === "available";

  async function togglePresence() {
    const rep = t.currentRep;
    if (!rep?.campaignId) return;
    await fetch(`/api/campaigns/${rep.campaignId}/reps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repId: rep.id,
        presence: rep.presence === "available" ? "away" : "available",
      }),
    });
    t.reloadReps();
  }

  return (
    <div className="flex h-full flex-col p-4">
      {/* Rep + presence */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">
            <UserRound className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">
              {solo ? "Solo" : t.currentRep?.name ?? "Rep"}
            </div>
            <button
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => t.setRepId(null)}
            >
              switch rep
            </button>
          </div>
        </div>
        {!solo && (
          <Button
            size="sm"
            variant={available ? "secondary" : "outline"}
            onClick={togglePresence}
            className="gap-2"
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                available ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            {available ? "Available" : "Away"}
          </Button>
        )}
      </div>

      {/* Softphone + the lead this rep is being served */}
      {!solo && (
        <div className="mt-3 space-y-3">
          <Softphone />
          <LeadCard />
        </div>
      )}

      {/* Who's on the line */}
      {!solo &&
        (t.incoming ? (
          <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
              <Phone className="h-3.5 w-3.5" /> On a call
            </div>
            <div className="mt-0.5 font-semibold">
              {t.incoming.name ?? "Unknown"}
              {t.incoming.company && (
                <span className="text-muted-foreground"> · {t.incoming.company}</span>
              )}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{t.incoming.phone}</div>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            No call in progress — press Call on the lead above.
          </div>
        ))}

      {/* Timer */}
      <div className="mt-6 text-center">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {t.hint ?? (onCall ? "On call" : "Idle — press 1–6 to start")}
        </div>
        <div className="mt-1 font-mono text-5xl font-bold leading-none tabular-nums">
          {fmtMs(t.elapsedMs)}
        </div>
      </div>

      {/* Compact state toggles (dialing/ringing, right/wrong person, …) */}
      <div className="mt-4">
        <BucketGrid compact />
      </div>

      {/* End call & save */}
      <div className="mt-4">
        <Button className="h-12 w-full gap-2 text-base" onClick={t.openEndCall}>
          <PhoneOff className="h-5 w-5" /> End call &amp; save
          <span className="ml-1 text-xs opacity-70">(Enter)</span>
        </Button>
      </div>

      <div className="mt-auto pt-4 text-center">
        <Link
          href="/console"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          Full console — tracking &amp; history <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
