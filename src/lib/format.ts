import type { Call } from "./types";
import { BUCKET_IDS } from "./config";

/** Format milliseconds as m:ss (or h:mm:ss past an hour). */
export function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const base = `${mm}:${String(sec).padStart(2, "0")}`;
  return h > 0 ? `${h}:${base}` : base;
}

/** Format milliseconds as m:ss.mmm (or h:mm:ss.mmm past an hour), for live timers. */
export function fmtMs(ms: number): string {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const msec = Math.floor(total % 1000);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const core = `${mm}:${String(s).padStart(2, "0")}.${String(msec).padStart(3, "0")}`;
  return h > 0 ? `${h}:${core}` : core;
}

export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Real elapsed duration of a saved call (start → end) — the accurate total,
 *  including any idle gaps between tracked buckets. Falls back to the sum of
 *  buckets if timestamps are missing/degenerate. */
export function callTotal(call: Call): number {
  const wall = (call.endedAt ?? 0) - (call.startedAt ?? 0);
  if (wall > 0) return wall;
  return BUCKET_IDS.reduce((sum, id) => sum + (call.acc[id] || 0), 0);
}

/** Sum of the tracked buckets (the "where did the time go" breakdown). */
export function trackedTotal(call: Call): number {
  return BUCKET_IDS.reduce((sum, id) => sum + (call.acc[id] || 0), 0);
}
