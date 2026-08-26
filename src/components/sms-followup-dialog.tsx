"use client";

import { useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The edit/approve step for a post-call follow-up text.
 *
 * Nothing sends without the rep pressing Send: the server drafts (after the
 * compliance gate), the rep edits, and only the approved text goes out. A
 * lead that can't legally be texted shows the gate's reason instead of a
 * draft, so there's never an editable message that can't be sent.
 */

export type SmsFollowupContext = {
  leadId: string;
  callAttemptId: string | null;
  phone: string;
  name: string | null;
  company: string | null;
  disposition: string | null;
  note: string;
  repId: string;
};

type Phase =
  | { kind: "loading" }
  | { kind: "blocked"; reason: string }
  | { kind: "editing"; draft: string }
  | { kind: "sending"; draft: string }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function SmsFollowupDialog({
  context,
  onClose,
}: {
  context: SmsFollowupContext | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!context} onOpenChange={(v) => !v && onClose()}>
      {/* Keyed remount gives each call's follow-up fresh state — no reset
          effects, no stale draft bleeding into the next call. */}
      {context && (
        <FollowupBody
          key={`${context.leadId}:${context.callAttemptId ?? "manual"}`}
          context={context}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function FollowupBody({
  context,
  onClose,
}: {
  context: SmsFollowupContext;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [body, setBody] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);

  // Draft on mount. The gate runs server-side first, so "blocked" arrives as a
  // regular payload, not an error.
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const r = await fetch("/api/sms/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: context.leadId,
            repId: context.repId,
            disposition: context.disposition,
            note: context.note,
          }),
        }).then((x) => x.json());
        if (disposed) return;
        if (r.ok) {
          setBody(r.draft);
          setPhase({ kind: "editing", draft: r.draft });
        } else if (r.blocked) {
          setPhase({
            kind: "blocked",
            reason: r.blocked.reason ?? "this lead can't be texted right now",
          });
        } else {
          setPhase({ kind: "error", message: r.error ?? "Drafting failed." });
        }
      } catch {
        if (!disposed) {
          setPhase({ kind: "error", message: "Couldn't reach the server." });
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [context]);

  async function send() {
    if (phase.kind !== "editing") return;
    const draft = phase.draft;
    setSendError(null);
    setPhase({ kind: "sending", draft });
    try {
      const r = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: context.leadId,
          callAttemptId: context.callAttemptId,
          repId: context.repId,
          body: body.trim(),
          draftBody: draft,
        }),
      }).then((x) => x.json());
      if (r.ok) {
        setPhase({ kind: "sent" });
        setTimeout(onClose, 1200);
      } else if (r.blocked) {
        setPhase({
          kind: "blocked",
          reason: r.blocked.reason ?? "this lead can't be texted right now",
        });
      } else {
        // Back to editing so the text isn't lost; the error shows inline.
        setPhase({ kind: "editing", draft });
        setSendError(r.error ?? "Send failed — try again.");
      }
    } catch {
      setPhase({ kind: "editing", draft });
      setSendError("Couldn't reach the server — try again.");
    }
  }

  const chars = body.trim().length;
  const editable = phase.kind === "editing" || phase.kind === "sending";

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4" /> Follow-up text
        </DialogTitle>
        <DialogDescription>
          To {context.name ?? context.phone}
          {context.company ? ` · ${context.company}` : ""} — edit before sending.
        </DialogDescription>
      </DialogHeader>

      {phase.kind === "loading" && (
        <p className="py-4 text-sm text-muted-foreground">Drafting…</p>
      )}

      {phase.kind === "blocked" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Can&apos;t text this lead: {phase.reason}.
        </p>
      )}

      {phase.kind === "error" && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {phase.message}
        </p>
      )}

      {editable && (
        <>
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setSendError(null);
            }}
            rows={4}
            disabled={phase.kind === "sending"}
            className="w-full rounded-lg border border-border bg-card p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className={cn(chars > 320 && "text-amber-600")}>
              {chars} characters{chars > 320 ? " — will send as multiple texts" : ""}
            </span>
            {sendError && <span className="text-destructive">{sendError}</span>}
          </div>
        </>
      )}

      {phase.kind === "sent" && (
        <p className="py-2 text-sm text-emerald-700">Sent.</p>
      )}

      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" onClick={onClose}>
          {editable ? "Cancel" : "Close"}
        </Button>
        {editable && (
          <Button onClick={send} disabled={phase.kind === "sending" || !body.trim()}>
            {phase.kind === "sending" ? "Sending…" : "Send"}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
