"use client";

import { useEffect, useState } from "react";
import { Activity, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ServiceView = {
  name: string;
  label: string;
  command: string;
  enabled: boolean;
  alive: boolean;
  lastSeen: string | null;
  detail: Record<string, unknown> | null;
};

const SHORT: Record<string, string> = { ingest: "Ingest" };

function dotColor(s: ServiceView): string {
  if (!s.alive) return "bg-red-500";
  return s.enabled ? "bg-emerald-500" : "bg-amber-500";
}

/**
 * Minimal, corner-pinned services widget: a small pill that shows each worker's
 * live heartbeat (green=running, amber=paused, red=down) and expands to a compact
 * card with an enable/pause toggle per service. Polls every 5s.
 */
export function ServicesPanel() {
    const [services, setServices] = useState<ServiceView[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await fetch("/api/services").then((x) => x.json());
        if (active) {
          setServices(r.services ?? []);
        }
      } catch {
        /* keep last state */
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const toggle = async (name: string, enabled: boolean) => {
    setBusy(name);
    try {
      const r = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: name, enabled }),
      }).then((x) => x.json());
      if (r.services) setServices(r.services);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-50">
      {open ? (
        <div className="w-60 rounded-lg border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold">Services</span>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Collapse"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-2">
            {services.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-2 px-1 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", dotColor(s))} />
                  <span className="truncate text-xs">
                    {SHORT[s.name] ?? s.label}
                    <span className="ml-1 text-muted-foreground">
                      {!s.alive ? "down" : s.enabled ? "on" : "paused"}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.enabled}
                  disabled={busy === s.name}
                  onClick={() => toggle(s.name, !s.enabled)}
                  title={!s.alive ? `Not running — start with ${s.command}` : s.enabled ? "Pause" : "Resume"}
                  className={cn(
                    "relative h-4 w-7 shrink-0 rounded-full transition-colors",
                    s.enabled ? "bg-emerald-500" : "bg-muted-foreground/30",
                    busy === s.name && "opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all",
                      s.enabled ? "left-[14px]" : "left-0.5",
                    )}
                  />
                </button>
              </div>
            ))}
            {services.length === 0 && (
              <p className="px-1 py-1 text-xs text-muted-foreground">Loading…</p>
            )}
          </div>

        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 shadow-md hover:bg-secondary/50"
          title="Services"
        >
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          {services.map((s) => (
            <span key={s.name} className={cn("h-2 w-2 rounded-full", dotColor(s))} />
          ))}
          <span className="text-xs font-medium">Services</span>
        </button>
      )}
    </div>
  );
}
