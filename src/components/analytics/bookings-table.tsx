"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Booked-meetings verification table. A manager checks off the calls whose
 * meetings actually landed; the toggle POSTs to /api/analytics/bookings and
 * refreshes the server component so the "X of Y verified" header and the
 * verifier attribution stay current.
 */

type Row = {
  id: string;
  startedAt: string; // ISO
  phone: string;
  repName: string | null;
  leadName: string | null;
  company: string | null;
  repNote: string | null;
  verified: boolean;
  verifiedByName: string | null;
};

function fmtWhen(iso: string, tz: string): string {
  return new Date(iso).toLocaleString(undefined, {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function BookingsTable({
  rows,
  timezone,
}: {
  rows: Row[];
  timezone: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(rows.map((r) => [r.id, r.verified])),
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function toggle(id: string) {
    const next = !state[id];
    setPending(id);
    setError("");
    setState((s) => ({ ...s, [id]: next })); // optimistic
    try {
      const r = await fetch("/api/analytics/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: id, verified: next }),
      }).then((x) => x.json());
      if (r.error) {
        setState((s) => ({ ...s, [id]: !next })); // revert
        setError("Couldn't save that — try again.");
      } else {
        router.refresh();
      }
    } catch {
      setState((s) => ({ ...s, [id]: !next }));
      setError("Couldn't reach the server.");
    } finally {
      setPending(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        No booked meetings logged yet. Calls a rep dispositions &ldquo;Booked
        meeting&rdquo; show up here for you to confirm.
      </p>
    );
  }

  return (
    <>
      {error && (
        <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Rep</th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2 text-center">Verified</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = state[r.id];
              return (
                <tr
                  key={r.id}
                  className={cn("border-t border-border", on && "bg-emerald-500/5")}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {fmtWhen(r.startedAt, timezone)}
                  </td>
                  <td className="px-3 py-2">{r.repName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.leadName ?? "Unknown lead"}</div>
                    {r.company && (
                      <div className="text-xs text-muted-foreground">{r.company}</div>
                    )}
                    {r.repNote && (
                      <div className="mt-0.5 text-xs italic text-muted-foreground">
                        &ldquo;{r.repNote}&rdquo;
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">{r.phone}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => toggle(r.id)}
                      disabled={pending === r.id}
                      aria-pressed={on}
                      aria-label={on ? "Verified — click to unverify" : "Mark verified"}
                      title={
                        on && r.verifiedByName
                          ? `Verified by ${r.verifiedByName}`
                          : undefined
                      }
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                        on
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-border text-transparent hover:border-emerald-400",
                        pending === r.id && "opacity-50",
                      )}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
