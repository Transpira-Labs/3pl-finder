"use client";

import { useEffect, useRef } from "react";
import { CalendarClock, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/format";
import type { Activity } from "./types";

function when(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? "" : fmtClock(t);
}

/**
 * Per-lead activity timeline as chat bubbles, oldest → newest, auto-scrolls to
 * the bottom whenever new activity arrives.
 *  - outcome / note → right-aligned accent bubbles (the rep's own words)
 *  - system / dialer → left-aligned muted bubbles
 *  - stage_change   → small centered divider
 *  - followup       → small centered scheduled-note line
 */
export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [activities.length]);

  if (activities.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
        <MessageSquare className="h-6 w-6 opacity-40" />
        <p>No activity yet.</p>
        <p className="text-xs">Log a call outcome below to start the timeline.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto py-1">
      {activities.map((a) => (
        <Bubble key={a.id} activity={a} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function Bubble({ activity: a }: { activity: Activity }) {
  if (a.kind === "stage_change") {
    return (
      <div className="my-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span className="whitespace-nowrap">{a.body}</span>
        <span className="whitespace-nowrap opacity-60">{when(a.createdAt)}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  if (a.kind === "followup") {
    return (
      <div className="my-0.5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <CalendarClock className="h-3 w-3" />
        <span>{a.body}</span>
        <span className="opacity-60">· {when(a.createdAt)}</span>
      </div>
    );
  }

  const mine = a.kind === "outcome" || a.kind === "note";
  return (
    <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-xl px-3 py-2 text-sm",
          mine
            ? "rounded-br-sm border border-primary/25 bg-primary/15 text-foreground"
            : "rounded-bl-sm bg-muted text-muted-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{a.body}</p>
        <div className={cn("mt-1 text-[10px]", mine ? "text-primary/70" : "text-muted-foreground/70")}>
          {a.templateKey && a.kind === "outcome" ? <span className="mr-1 opacity-80">outcome</span> : null}
          {when(a.createdAt)}
        </div>
      </div>
    </div>
  );
}
