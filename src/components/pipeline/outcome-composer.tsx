"use client";

import { useState } from "react";
import { CalendarClock, Mail, Phone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OUTCOME_TEMPLATES, type OutcomeTemplate } from "@/lib/config";
import type { Activity, FollowUpChannel } from "./types";

/** Body sent to POST /api/leads/[id]/activity — matches the frozen §5 contract. */
type ActivityBody = {
  kind: "outcome" | "note";
  templateKey?: string;
  body: string;
  stage?: string;
  followUp?: { channel: FollowUpChannel; dueAt: string; note?: string };
};

type PostResult = { activity: Activity };

function plusHours(h: number): Date {
  return new Date(Date.now() + h * 3600_000);
}
function tomorrow9(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}
function plusDays(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
/** Convert a Date to the local value a datetime-local input expects. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

type Preset = { key: string; label: string; make: () => Date };
const PRESETS: Preset[] = [
  { key: "1h", label: "+1 hour", make: () => plusHours(1) },
  { key: "tomorrow", label: "Tomorrow 9am", make: tomorrow9 },
  { key: "3d", label: "+3 days", make: () => plusDays(3) },
];

export function OutcomeComposer({
  leadId,
  onOptimistic,
  onRollback,
  onSettled,
}: {
  leadId: string;
  /** Append a provisional bubble immediately for a responsive feel. */
  onOptimistic: (activity: Activity) => void;
  /** Remove a provisional bubble by id when its POST fails. */
  onRollback: (activityId: string) => void;
  /** Re-fetch the lead detail once the server has committed. */
  onSettled: () => void;
}) {
  const [body, setBody] = useState("");
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [stage, setStage] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow-up scheduler (revealed when a template suggests one).
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [channel, setChannel] = useState<FollowUpChannel>("call");
  const [presetKey, setPresetKey] = useState<string>("tomorrow");
  const [customLocal, setCustomLocal] = useState<string>(toLocalInput(tomorrow9()));
  const [fuNote, setFuNote] = useState("");

  function pickTemplate(t: OutcomeTemplate) {
    if (templateKey === t.key) {
      // toggle off
      setTemplateKey(null);
      setStage(undefined);
      setShowFollowUp(false);
      return;
    }
    setTemplateKey(t.key);
    setBody(t.body);
    setStage(t.stage);
    if (t.suggestFollowUp) {
      setChannel(t.suggestFollowUp);
      setShowFollowUp(true);
      setPresetKey("tomorrow");
      setCustomLocal(toLocalInput(tomorrow9()));
      setFuNote("");
    } else {
      setShowFollowUp(false);
    }
  }

  function dueAtIso(): string {
    if (presetKey === "custom") {
      const d = new Date(customLocal);
      return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
    const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[1];
    return preset.make().toISOString();
  }

  function reset() {
    setBody("");
    setTemplateKey(null);
    setStage(undefined);
    setShowFollowUp(false);
    setFuNote("");
  }

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);

    const payload: ActivityBody = {
      kind: templateKey ? "outcome" : "note",
      body: text,
    };
    if (templateKey) payload.templateKey = templateKey;
    if (stage) payload.stage = stage;
    if (showFollowUp) {
      payload.followUp = {
        channel,
        dueAt: dueAtIso(),
        ...(fuNote.trim() ? { note: fuNote.trim() } : {}),
      };
    }

    // Optimistic bubble — replaced by the real activity on refetch (success), or
    // rolled back on failure so a failed POST never leaves a phantom bubble.
    const optimisticId = `optimistic-${Date.now()}`;
    onOptimistic({
      id: optimisticId,
      leadId,
      callAttemptId: null,
      repId: null,
      kind: payload.kind,
      templateKey: templateKey ?? null,
      body: text,
      meta: null,
      createdAt: new Date().toISOString(),
    });

    try {
      const res = await fetch(`/api/leads/${leadId}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`activity POST failed: ${res.status}`);
      await res.json().catch(() => ({} as PostResult));
      // Only clear the composer + refetch once the server has committed.
      reset();
      onSettled();
    } catch {
      // Keep the rep's text so nothing is silently discarded; drop the phantom
      // bubble and surface a retryable error.
      onRollback(optimisticId);
      setError("Couldn't save that outcome — please retry.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-3">
      {/* Template chips */}
      <div className="flex flex-wrap gap-1.5">
        {OUTCOME_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => pickTemplate(t)}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98]",
              templateKey === t.key
                ? "bg-primary text-primary-foreground"
                : "bg-primary/15 text-primary hover:bg-primary/25",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Free-text composer */}
      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Write a call outcome or note… (Enter to send, Shift+Enter for newline)"
          className="min-h-[42px] w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button onClick={send} disabled={!body.trim() || sending} className="gap-1.5">
          <Send className="h-4 w-4" />
          Send
        </Button>
      </div>

      {error && <p className="mt-1.5 text-xs font-medium text-destructive">{error}</p>}

      {/* Inline follow-up scheduler */}
      {showFollowUp && (
        <div className="mt-2 rounded-lg border border-dashed border-border p-2.5">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Schedule follow-up
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* channel toggle */}
            <div className="flex overflow-hidden rounded-md border border-border">
              <button
                type="button"
                onClick={() => setChannel("call")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-xs outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.98]",
                  channel === "call" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <Phone className="h-3 w-3" /> Call
              </button>
              <button
                type="button"
                onClick={() => setChannel("email")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-xs outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.98]",
                  channel === "email" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <Mail className="h-3 w-3" /> Email
              </button>
            </div>

            {/* date presets */}
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPresetKey(p.key)}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98]",
                  presetKey === p.key
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPresetKey("custom")}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98]",
                presetKey === "custom"
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              Custom
            </button>
            {presetKey === "custom" && (
              <input
                type="datetime-local"
                value={customLocal}
                onChange={(e) => setCustomLocal(e.target.value)}
                className="rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:border-ring"
              />
            )}
          </div>

          <input
            value={fuNote}
            onChange={(e) => setFuNote(e.target.value)}
            placeholder={
              channel === "email"
                ? "Who / what to email (e.g. send pricing to jane@acme.com)"
                : "Note (optional)"
            }
            className="mt-2 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      )}
    </div>
  );
}
