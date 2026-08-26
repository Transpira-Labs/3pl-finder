"use client";

import { useEffect, useRef, useState } from "react";
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
import { DISPOSITIONS } from "@/lib/config";

/**
 * Shown when a call ends: tag the outcome (letter key or click) + optional note.
 * Radix Dialog handles Esc/overlay dismissal; we add the letter-key shortcuts.
 */
export function DispositionDialog({
  open,
  onOpenChange,
  onSave,
  error,
  smsOffered = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (dispositionId: string | null, note: string, sendSms: boolean) => void;
  /** Save failed — shown in place of closing, so the call isn't lost silently. */
  error?: string | null;
  /** Offer the follow-up-text checkbox (dialer calls with a real lead only). */
  smsOffered?: boolean;
}) {
  const [note, setNote] = useState("");
  const [sendSms, setSendSms] = useState(false);
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNote("");
    // Opt-in per call, never sticky — a follow-up text is a deliberate act.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSendSms(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === noteRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          onSave(null, note, sendSms);
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onSave(null, note, sendSms);
        return;
      }
      const d = DISPOSITIONS.find((x) => x.key === e.key.toLowerCase());
      if (d) {
        e.preventDefault();
        onSave(d.id, note, sendSms);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, note, sendSms, onSave]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How did the call end?</DialogTitle>
          <DialogDescription>
            Tag the outcome — press its key or click.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {DISPOSITIONS.map((d) => (
            <Button
              key={d.id}
              variant="outline"
              onClick={() => onSave(d.id, note, sendSms)}
              className="h-auto justify-between px-3 py-2.5 font-normal"
            >
              <span>{d.label}</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {d.key}
              </kbd>
            </Button>
          ))}
        </div>
        <Input
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (company, name, next step)…"
        />
        {smsOffered && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={sendSms}
              onChange={(e) => setSendSms(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Send a follow-up text (you review it first)
          </label>
        )}
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error} Your tracked time is still here — pick an outcome to retry.
          </p>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button onClick={() => onSave(null, note, sendSms)}>Save without tag</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
