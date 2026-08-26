"use client";

import {
  Download,
  FileSpreadsheet,
  Pause,
  PhoneOff,
  Phone,
  Trash2,
  UserRound,
} from "lucide-react";
import { useTracker } from "@/components/tracker-provider";
import { RepPicker } from "@/components/rep-picker";
import { BucketGrid } from "@/components/bucket-grid";
import { StatCards } from "@/components/stat-cards";
import { HistoryTable } from "@/components/history-table";
import { SyncPanel } from "@/components/sync-panel";
import { Softphone } from "@/components/softphone";
import { LeadCard } from "@/components/lead-card";
import { Button } from "@/components/ui/button";
import { BUCKETS } from "@/lib/config";
import { fmtMs } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

export function ConsoleView() {
  const t = useTracker();

  // Identity first: nothing selected → show the picker (rep or solo).
  if (!t.repId) return <RepPicker />;

  const active = BUCKETS.find((b) => b.id === t.active);
  const onCall = t.active !== "idle";
  const solo = t.solo;

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

  const available = t.currentRep?.presence === "available";

  return (
    <div className="mx-auto max-w-5xl px-5 py-5">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">
            <UserRound className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">
              {solo ? "Solo mode" : t.currentRep?.name ?? "Rep"}
            </div>
            <button
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => t.setRepId(null)}
            >
              {solo ? "exit solo" : "switch rep"}
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
      </header>

      {/* In-browser softphone + the lead the rep is being served. Solo mode has
          neither — it's a bare stopwatch with no queue and no DB. */}
      {!solo && (
        <div className="mt-4 space-y-4">
          <Softphone />
          <LeadCard />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Live call */}
        <section className="rounded-xl border border-border bg-card p-5">
          {/* Active lead context — dialer mode only */}
          {!solo &&
            (t.incoming ? (
              <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-600">
                  <Phone className="h-3.5 w-3.5" /> On a call
                </div>
                <div className="mt-1 font-semibold">
                  {t.incoming.name ?? "Unknown"}
                  {t.incoming.company && (
                    <span className="text-muted-foreground"> · {t.incoming.company}</span>
                  )}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {t.incoming.phone}
                  {t.incoming.note && <span> · {t.incoming.note}</span>}
                </div>
              </div>
            ) : (
              <div className="mb-4 rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                No call in progress — press Call on the lead above to start one.
              </div>
            ))}

          <div className="text-center">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t.hint ?? (active ? active.name : "Idle — press 1–6 to start")}
            </div>
            <div
              className="mt-1 font-mono text-5xl font-bold leading-none tabular-nums"
              style={active ? { color: active.color } : undefined}
            >
              {fmtMs(t.elapsedMs)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">current call</div>
          </div>

          <div className="mt-5">
            <BucketGrid />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button className="flex-1 gap-2" onClick={t.openEndCall}>
              <PhoneOff className="h-4 w-4" /> End call &amp; save
            </Button>
            <Button variant="secondary" className="gap-2" onClick={() => t.switchTo("idle")}>
              <Pause className="h-4 w-4" /> Pause
            </Button>
          </div>

          <p className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
            <Kbd>1</Kbd>–<Kbd>6</Kbd> switch
            <span className="opacity-40">·</span>
            <Kbd>Space</Kbd> pause
            <span className="opacity-40">·</span>
            <Kbd>Enter</Kbd> end call
          </p>
          {!solo && onCall && (
            <p className="mt-1 text-center text-[11px] text-muted-foreground">
              Ring time is recorded from Twilio — you track the conversation.
            </p>
          )}
        </section>

        {/* History + stats */}
        <section className="min-w-0 space-y-4">
          <StatCards calls={t.calls} />
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {solo ? "Recent calls" : "Your recent calls"}
            </h2>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => downloadCsv(t.calls)}
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              {solo && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-destructive"
                  onClick={() => {
                    if (confirm("Delete ALL saved call history? This cannot be undone."))
                      t.clearAll();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear
                </Button>
              )}
            </div>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <HistoryTable
              calls={t.calls}
              onDelete={solo ? t.deleteCall : undefined}
            />
          </div>
        </section>
      </div>

      {/* Google Sheet sync — always visible */}
      <section className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <FileSpreadsheet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Google Sheet sync</h2>
            <p className="text-xs text-muted-foreground">
              Paste a Google Sheet link to auto-append every finished call. One-time
              setup in SHEETS_SETUP.md.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <SyncPanel
            calls={t.calls}
            hydrated={t.hydrated}
            onMarkSynced={t.markSynced}
          />
        </div>
      </section>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}
