"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type MessageTemplate,
  messageTemplateFor,
  messageTemplateForDisposition,
  renderTemplate,
} from "@/lib/config";

type Eligibility = {
  allowed: boolean;
  configured: boolean;
  reason: string | null;
  toAddress?: string | null;
} | null;

export type SendFollowupTarget = {
  leadId: string;
  callAttemptId?: string | null;
  name: string | null;
  company: string | null;
  /** Console flow: pick the template from the disposition the rep tagged. */
  dispositionId?: string | null;
  /** Pipeline flow: an explicit template key (overrides dispositionId). */
  templateKey?: string | null;
};

/**
 * Review-and-send a follow-up email to a lead, prefilled from the call outcome.
 * The rep sees the message, can edit it, and sends. Sending is enabled only when
 * the server says the lead is emailable (has an email, consent, not unsubscribed)
 * and email is configured — the reason shows when not.
 *
 * The body is resolved client-side from the template so the rep can review it, but
 * the destination address is resolved server-side on send (the POST carries only
 * leadId + text) — the browser never supplies the email.
 */
export function SendFollowupDialog({
  open,
  onOpenChange,
  target,
  repName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: SendFollowupTarget | null;
  repName: string | null;
}) {
  const template: MessageTemplate | null = target
    ? target.templateKey
      ? messageTemplateFor(target.templateKey)
      : messageTemplateForDisposition(target.dispositionId ?? null)
    : null;

  const [elig, setElig] = useState<Eligibility>(null);
  const [loadingElig, setLoadingElig] = useState(true);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const leadId = target?.leadId ?? null;

  const prefill = useCallback(() => {
    if (!template) {
      setSubject("");
      setBody("");
      return;
    }
    const vars = {
      name: target?.name ?? null,
      company: target?.company ?? null,
      rep: repName,
    };
    setSubject(renderTemplate(template.email.subject, vars));
    setBody(renderTemplate(template.email.body, vars));
  }, [template, target?.name, target?.company, repName]);

  // Load email eligibility each time the dialog opens for a lead.
  useEffect(() => {
    if (!open || !leadId) return;
    let active = true;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingElig(true);
    setError(null);
    setSent(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    (async () => {
      let e: Eligibility;
      try {
        e = await fetch(`/api/messaging/eligibility?leadId=${leadId}`).then((x) =>
          x.json(),
        );
      } catch {
        e = { allowed: false, configured: true, reason: "Couldn't check eligibility." };
      }
      if (!active) return;
      setElig(e);
      prefill();
      setLoadingElig(false);
    })();
    return () => {
      active = false;
    };
    // prefill/template are derived from target; re-run only on open/lead change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId]);

  const canSend =
    !!elig?.allowed && !!body.trim() && !sending && !loadingElig && !sent;

  async function send() {
    if (!target || !canSend) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/messaging/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: target.leadId,
          channel: "email",
          body: body.trim(),
          subject: subject.trim(),
          ...(template ? { templateKey: template.key } : {}),
          ...(target.callAttemptId ? { callAttemptId: target.callAttemptId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `Couldn't send (${res.status}).`);
        return;
      }
      setSent(true);
      setTimeout(() => onOpenChange(false), 1100);
    } catch {
      setError("Couldn't reach the server — please retry.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send a follow-up email</DialogTitle>
          <DialogDescription>
            {target?.name
              ? `To ${target.name}${target.company ? ` · ${target.company}` : ""}`
              : "Review the message, then send."}
          </DialogDescription>
        </DialogHeader>

        {/* Blocked reason */}
        {elig && !elig.allowed && !loadingElig && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Can&apos;t email this lead:{" "}
            {elig.configured
              ? (elig.reason ?? "not eligible")
              : "Email isn't configured on the server."}
          </p>
        )}

        {elig?.allowed && elig.toAddress && (
          <p className="text-xs text-muted-foreground">
            Sending to <span className="font-mono">{elig.toAddress}</span>
          </p>
        )}

        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          disabled={!elig?.allowed || sent}
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder={loadingElig ? "Checking eligibility…" : "Write your follow-up…"}
          disabled={!elig?.allowed || sent}
          className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        />

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {sent ? "Close" : "Not now"}
          </Button>
          <Button onClick={send} disabled={!canSend} className="gap-1.5">
            {sent ? (
              <>
                <Check className="h-4 w-4" /> Sent
              </>
            ) : sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Send email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
