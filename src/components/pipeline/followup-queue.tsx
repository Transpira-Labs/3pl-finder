"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Mail, Phone, Timer, CalendarCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/format";
import { StageBadge } from "./stage-badge";
import type { FollowUpRow, FollowUpsResponse } from "./types";

function when(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? "—" : fmtClock(t);
}

const SNOOZE_PRESETS: { key: string; label: string; make: () => Date }[] = [
  { key: "1h", label: "+1h", make: () => new Date(Date.now() + 3600_000) },
  {
    key: "tomorrow",
    label: "Tomorrow 9am",
    make: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    key: "3d",
    label: "+3d",
    make: () => {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      return d;
    },
  },
];

export function FollowUpQueue({
  refreshKey,
  onOpenLead,
  onChanged,
}: {
  /** Bump to force a re-fetch (e.g. after a follow-up is scheduled elsewhere). */
  refreshKey: number;
  onOpenLead: (leadId: string) => void;
  /** Notify parent after a mutation so the header badge/summary refreshes. */
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<FollowUpRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const r: FollowUpsResponse = await fetch("/api/followups?status=pending&due=all").then((x) =>
      x.json(),
    );
    if (!("error" in (r as object))) {
      const list = (r.followUps ?? []).slice().sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      setRows(list);
    }
    setNow(Date.now());
    setLoaded(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const poll = setInterval(load, 30000);
    return () => clearInterval(poll);
  }, [load, refreshKey]);

  async function complete(id: string) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onChanged();
      load();
    } catch {
      setRows(prev); // restore the optimistically-removed row on failure
    }
  }

  async function snooze(id: string, dueAt: Date) {
    setSnoozing(null);
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id)); // will reappear at new time on reload
    try {
      const res = await fetch(`/api/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: dueAt.toISOString() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onChanged();
      load();
    } catch {
      setRows(prev); // restore the optimistically-removed row on failure
    }
  }

  if (loaded && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        <CalendarCheck2 className="h-7 w-7 opacity-40" />
        <p className="font-medium text-foreground">You&apos;re all caught up</p>
        <p>No pending follow-ups. Scheduled callbacks and emails will show up here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const overdue = new Date(r.dueAt).getTime() <= now;
        return (
          <div
            key={r.id}
            className={cn(
              "rounded-xl border bg-card p-3",
              overdue ? "border-red-300" : "border-border",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-md",
                    r.channel === "call"
                      ? "bg-sky-100 text-sky-700"
                      : "bg-purple-100 text-purple-700",
                  )}
                >
                  {r.channel === "call" ? <Phone className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{r.lead.name ?? "Unknown"}</span>
                    <StageBadge stage={r.lead.pipelineStage} />
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">{r.lead.phone}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs",
                    overdue ? "font-medium text-red-700" : "text-muted-foreground",
                  )}
                >
                  <Timer className="h-3 w-3" />
                  {overdue ? "Overdue · " : ""}
                  {when(r.dueAt)}
                </span>
              </div>
            </div>

            {r.note && <p className="mt-2 text-xs text-muted-foreground">{r.note}</p>}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Button size="xs" variant="secondary" className="gap-1" onClick={() => complete(r.id)}>
                <Check className="h-3 w-3" /> Done
              </Button>

              {snoozing === r.id ? (
                <div className="flex items-center gap-1">
                  {SNOOZE_PRESETS.map((p) => (
                    <Button
                      key={p.key}
                      size="xs"
                      variant="outline"
                      onClick={() => snooze(r.id, p.make())}
                    >
                      {p.label}
                    </Button>
                  ))}
                  <Button size="xs" variant="ghost" onClick={() => setSnoozing(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="xs" variant="outline" className="gap-1" onClick={() => setSnoozing(r.id)}>
                  <Timer className="h-3 w-3" /> Snooze
                </Button>
              )}

              <Button
                size="xs"
                variant="ghost"
                className="gap-1"
                onClick={() => onOpenLead(r.lead.id)}
              >
                <ExternalLink className="h-3 w-3" /> Open lead
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
