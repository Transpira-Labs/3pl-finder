import type { Call, CurrentCall } from "./types";

/**
 * localStorage persistence. This is the seam to swap for a real backend later
 * (e.g. a Next.js API route + database) when you add accounts / multi-device.
 * Keep the same shapes and the rest of the app won't care.
 */

const K_CALLS = "att.calls.v1";
const K_CURRENT = "att.current.v1";
const K_SYNC = "att.syncUrl.v1";

export function loadCalls(): Call[] {
  try {
    return JSON.parse(localStorage.getItem(K_CALLS) || "[]") as Call[];
  } catch {
    return [];
  }
}
export function saveCalls(calls: Call[]): void {
  localStorage.setItem(K_CALLS, JSON.stringify(calls));
}

/**
 * How long an in-progress call may sit in localStorage before we refuse to
 * restore it. Restoring is meant to survive a refresh or an accidental tab
 * close, not to resume yesterday's call: `activeSince` is an absolute timestamp,
 * so a day-old restore would show (and, on save, bank) a multi-hour duration in
 * whichever bucket happened to be running.
 */
const CURRENT_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

export function loadCurrent(): CurrentCall | null {
  try {
    const c = JSON.parse(localStorage.getItem(K_CURRENT) || "null");
    if (!c || !c.acc) return null;
    const call = c as CurrentCall;
    // Age it from the most recent activity we know of, so an idle-but-open call
    // isn't discarded while a genuinely abandoned one is.
    const lastTouch = Math.max(
      call.activeSince ?? 0,
      call.firstActiveAt ?? 0,
      call.startedAt ?? 0,
    );
    if (!lastTouch || Date.now() - lastTouch > CURRENT_MAX_AGE_MS) {
      localStorage.removeItem(K_CURRENT);
      return null;
    }
    return call;
  } catch {
    return null;
  }
}
export function saveCurrent(c: CurrentCall): void {
  localStorage.setItem(K_CURRENT, JSON.stringify(c));
}
export function clearCurrent(): void {
  localStorage.removeItem(K_CURRENT);
}

export function loadSyncUrl(): string {
  return localStorage.getItem(K_SYNC) || "";
}
export function saveSyncUrl(url: string): void {
  localStorage.setItem(K_SYNC, url);
}
