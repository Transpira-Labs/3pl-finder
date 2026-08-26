"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Headphones, X } from "lucide-react";
import { TrackerProvider, useTracker } from "@/components/tracker-provider";
import { ConsoleMini } from "@/components/console-mini";
import { DispositionHost } from "@/components/disposition-host";
import { cn } from "@/lib/utils";

/**
 * Floating Call Console for admins — an always-available launcher (like a chat
 * widget) that slides open the full console, so admins don't have to switch to
 * the /console tab. Mounted globally (app-shell, admin only).
 *
 * It has its OWN TrackerProvider and stays mounted so the rep's softphone keeps
 * receiving calls even while the drawer is closed. To avoid two softphones
 * registering the same identity (Twilio ConnectionError), the dock hides itself
 * on the /console route, where the full page already runs a console.
 */
export function ConsoleDock() {
  const pathname = usePathname();
  if (pathname.startsWith("/console")) return null;
  return (
    <TrackerProvider>
      <DockInner />
      <DispositionHost />
    </TrackerProvider>
  );
}

function DockInner() {
  const [open, setOpen] = useState(false);
  const t = useTracker();
  const onCall = !!t.repId && t.active !== "idle";
  const connected = !!t.incoming;

  return (
    <>
      {/* Launcher button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105",
          onCall ? "bg-emerald-600 text-white" : "bg-primary text-primary-foreground",
        )}
        title="Call console"
        aria-label="Open call console"
      >
        <Headphones className="h-5 w-5" />
        {(onCall || connected) && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-card" />
          </span>
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Slide-over drawer (always mounted so the softphone stays live; slid
          off-screen when closed) */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-[360px] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Headphones className="h-4 w-4" /> Call Console
          </div>
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <ConsoleMini />
        </div>
      </aside>
    </>
  );
}
