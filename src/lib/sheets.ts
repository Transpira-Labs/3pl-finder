import type { Call } from "./types";
import { callTotal } from "./format";
import { dispositionLabel } from "./config";

/**
 * Google Sheets live sync (client side).
 *
 * The browser never talks to Google directly — it POSTs finished calls to our own
 * `/api/sheets` route, which holds the service-account credentials and appends to
 * the Sheet. The user only ever pastes a normal Google Sheet link; setup is in
 * SHEETS_SETUP.md. Each call has a stable id and the server de-dupes on it, so
 * retries are safe.
 */

/** Column order written to the Sheet (shared by client + server). */
export const SHEET_HEADERS = [
  "id",
  "started",
  "ended",
  "ringing",
  "waiting",
  "right",
  "wrong",
  "voicemail",
  "noanswer",
  "total",
  "disposition",
  "note",
] as const;

export type SheetRow = Record<(typeof SHEET_HEADERS)[number], string | number>;

/** 0-based indices of the duration columns (ringing … total) in SHEET_HEADERS. */
export const DURATION_COL_START = 3; // "ringing"
export const DURATION_COL_END = 10; // exclusive; "total" is index 9
/** Elapsed-time format applied to the duration columns: 0:01:23.456, summable. */
export const DURATION_FORMAT = "[h]:mm:ss.000";

const MS_PER_DAY = 86_400_000;

/**
 * A duration as a fraction of a day. Written as a real number so the Sheet can
 * render it as elapsed time ([h]:mm:ss.000 — readable) AND still SUM/AVG it,
 * while keeping the underlying millisecond precision.
 */
export const durationValue = (ms: number): number => Math.max(0, ms || 0) / MS_PER_DAY;

/** Human-readable UTC timestamp, "YYYY-MM-DD HH:MM:SS" (sorts correctly as text). */
export const readableTimestamp = (d: Date | number): string =>
  new Date(d).toISOString().slice(0, 19).replace("T", " ");

export function callToRow(c: Call): SheetRow {
  return {
    id: c.id,
    started: readableTimestamp(c.startedAt),
    ended: readableTimestamp(c.endedAt),
    ringing: durationValue(c.acc.ringing),
    waiting: durationValue(c.acc.waiting),
    right: durationValue(c.acc.right),
    wrong: durationValue(c.acc.wrong),
    voicemail: durationValue(c.acc.voicemail),
    noanswer: durationValue(c.acc.noanswer),
    // Real call duration (start → end), not the sum of tracked buckets.
    total: durationValue(callTotal(c)),
    disposition: dispositionLabel(c.disposition),
    note: c.note || "",
  };
}

type PingResult = { ok: boolean; email?: string; error?: string };

async function callApi(payload: unknown): Promise<Record<string, unknown>> {
  const res = await fetch("/api/sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ...data, _status: res.status };
}

/** Verify the server can read the pasted Sheet. Returns the address to share with. */
export async function pingSheet(sheetUrl: string): Promise<PingResult> {
  const data = await callApi({ action: "ping", sheetUrl });
  return {
    ok: data.ok === true,
    email: data.serviceAccountEmail as string | undefined,
    error: data.error as string | undefined,
  };
}

/**
 * Push all not-yet-synced calls. Returns the ids that were successfully synced,
 * so the caller marks exactly those (merge-safe even if new calls arrived
 * mid-sync). On failure nothing is marked and it's retried next time.
 */
export async function syncCalls(
  sheetUrl: string,
  calls: Call[],
): Promise<string[]> {
  const rows = calls.filter((c) => !c.synced).map(callToRow);
  if (rows.length === 0) return [];
  const data = await callApi({ action: "sync", sheetUrl, rows });
  if (data.ok !== true) {
    throw new Error((data.error as string) || "Sync failed.");
  }
  return (data.syncedIds as string[]) ?? [];
}

/**
 * Push calls to the admin-configured call-log Sheet (Settings → Connections).
 * The URL lives server-side, so the client never handles it. Returns the ids
 * that reached the sheet; an empty array means either nothing to sync OR no
 * sheet is configured yet — the caller keeps those calls unsynced for a retry.
 * Best-effort: any error resolves to [] rather than throwing.
 */
export async function syncCallsDefault(calls: Call[]): Promise<string[]> {
  const rows = calls.filter((c) => !c.synced).map(callToRow);
  if (rows.length === 0) return [];
  try {
    const data = await callApi({ action: "syncDefault", rows });
    if (data.ok !== true) return [];
    return (data.syncedIds as string[]) ?? [];
  } catch {
    return [];
  }
}
