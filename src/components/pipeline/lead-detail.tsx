"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Phone, PhoneCall, Send, UserRound } from "lucide-react";
import { fmtClock } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { SendFollowupDialog } from "@/components/send-followup";
import { ActivityTimeline } from "./activity-timeline";
import { OutcomeComposer } from "./outcome-composer";
import { STAGE_ORDER, stageLabel } from "./stage-badge";
import type { Activity, LeadBase, LeadDetailResponse, Stage } from "./types";

function when(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? "—" : fmtClock(t);
}

export function LeadDetail({
  leadId,
  onChanged,
}: {
  leadId: string | null;
  /** Called after any mutation so the parent can refresh the table + summary + queue. */
  onChanged: () => void;
}) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadBase | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const r: LeadDetailResponse = await fetch(`/api/leads/${leadId}`).then((x) => x.json());
      if (!("error" in (r as object))) {
        setLead(r.lead);
        setActivities(r.activities ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function changeStage(next: Stage) {
    if (!leadId || !lead || next === lead.pipelineStage) return;
    setLead({ ...lead, pipelineStage: next }); // optimistic
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineStage: next }),
    });
    await load();
    onChanged();
  }

  if (!leadId) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        <UserRound className="h-7 w-7 opacity-40" />
        <p className="font-medium text-foreground">No lead selected</p>
        <p>Pick a lead from the list to see its call history and log an outcome.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[400px] flex-col">
      {/* Lead header */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              {lead?.name ?? "Unknown lead"}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {lead?.company && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {lead.company}
                </span>
              )}
              <span className="inline-flex items-center gap-1 font-mono">
                <Phone className="h-3 w-3" />
                {lead?.phone ?? "—"}
              </span>
              <span>Last contacted {when(lead?.lastContacted ?? null)}</span>
            </div>
          </div>
          <div className="flex items-end gap-2">
            {/* Jump to the console with this lead claimed — the direct-dial
                path for a follow-up call. The console's softphone does the
                dialing; the server enforces claim, campaign, and compliance. */}
            <Button
              size="sm"
              className="h-8 gap-1.5"
              disabled={!lead?.phone}
              onClick={() => router.push(`/console?lead=${leadId}`)}
            >
              <PhoneCall className="h-3.5 w-3.5" /> Call
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={!lead}
              onClick={() => setSendOpen(true)}
            >
              <Send className="h-3.5 w-3.5" /> Send follow-up
            </Button>
            <label className="flex flex-col gap-1 text-xs">
              <span className="uppercase tracking-wide text-muted-foreground">Stage</span>
              <select
                value={lead?.pipelineStage ?? "new"}
                onChange={(e) => changeStage(e.target.value as Stage)}
                disabled={!lead}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
              >
                {STAGE_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <SendFollowupDialog
        open={sendOpen}
        onOpenChange={(v) => {
          setSendOpen(v);
          if (!v) load(); // pick up the "message sent" timeline bubble
        }}
        target={
          lead
            ? { leadId: lead.id, name: lead.name, company: lead.company }
            : null
        }
        repName={null}
      />

      {/* Timeline */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Activity</div>
          {loading && <div className="text-[11px] text-muted-foreground">loading…</div>}
        </div>
        <div className="flex max-h-[46vh] min-h-[220px] flex-1 flex-col">
          <ActivityTimeline activities={activities} />
        </div>
      </div>

      {/* Composer */}
      <OutcomeComposer
        leadId={leadId}
        onOptimistic={(a) => setActivities((prev) => [...prev, a])}
        onRollback={(id) => setActivities((prev) => prev.filter((a) => a.id !== id))}
        onSettled={() => {
          load();
          onChanged();
        }}
      />
    </div>
  );
}
