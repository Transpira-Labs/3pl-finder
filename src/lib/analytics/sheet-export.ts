import { BUCKETS, DISPOSITIONS } from "@/lib/config";
import { durationValue, DURATION_FORMAT } from "@/lib/sheets";
import {
  SheetsError,
  extractSpreadsheetId,
  ensureNamedTab,
  sheetsApi,
  sheetsToken,
  tabUrl,
} from "@/lib/sheets-server";
import { getConsoleSheetUrl } from "@/lib/settings";
import { dayStats, type DayStats, type DayMetrics } from "./stats";
import { reportingTimezone } from "./service";

/**
 * Push computed analytics into the same Google Sheet that already collects the
 * raw call rows, so the numbers live where the data does.
 *
 * Two surfaces:
 *  - a running `Analytics` tab, one row per calling day, upserted as calls land;
 *  - one tab per exported day (`Analytics 2026-07-30`) with the full breakdown.
 *
 * This module owns the *layout* (which columns, which sections) because that is
 * analytics domain knowledge; `sheets-server.ts` stays a generic transport and
 * never imports the database layer.
 *
 * Note both surfaces refuse to touch a tab they didn't create — a sheet is a
 * user's document, and silently overwriting one would be unforgivable.
 */

export const ANALYTICS_TAB = "Analytics";
/** First cell of an exported day tab; doubles as the "we own this tab" marker. */
const DAY_TAB_MARKER = "Call analytics — ";
const PERCENT_FORMAT = "0.0%";

/** The synthetic disposition stats.ts uses for undispositioned calls. */
const NO_DISPOSITION = "none";

const bucketHeader = (short: string) => `Time: ${short}`;
const outcomeHeader = (label: string) => `Outcome: ${label}`;
const NOT_DISPOSITIONED = outcomeHeader("Not dispositioned");

/**
 * Header row for the running tab, generated from the same constants the app
 * uses everywhere else so the vocabularies stay single-sourced.
 *
 * BUCKETS and DISPOSITIONS both contain an id called `voicemail`, so the raw
 * ids can't be column names — hence the `Time:` / `Outcome:` prefixes.
 */
function analyticsHeaders(): string[] {
  return [
    "day",
    "calls",
    "connects",
    "connect rate",
    "talk time",
    "median call",
    "longest call",
    ...BUCKETS.map((b) => bucketHeader(b.short)),
    ...DISPOSITIONS.map((d) => outcomeHeader(d.label)),
    NOT_DISPOSITIONED,
    "first call",
    "last call",
    "reps",
    "note",
    "tags",
    "updated",
  ];
}

/** Clock time in the reporting timezone, for the first/last call columns. */
function localClock(iso: string | null, tz: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** One day as a header-keyed record, so column order is never assumed. */
function dayRowRecord(stats: DayStats): Record<string, string | number> {
  const t = stats.today;
  const row: Record<string, string | number> = {
    day: stats.day,
    calls: t.calls,
    connects: t.connects,
    "connect rate": t.connectRate,
    "talk time": durationValue(t.totalTalkMs),
    "median call": durationValue(t.medianTalkMs),
    "longest call": durationValue(t.longestTalkMs),
    "first call": localClock(stats.firstCallAt, stats.timezone),
    "last call": localClock(stats.lastCallAt, stats.timezone),
    reps: stats.byRep.length,
    note: stats.note?.note ?? "",
    tags: (stats.note?.tags ?? []).join(", "),
    updated: new Date().toISOString().replace("T", " ").slice(0, 19),
  };
  for (const b of BUCKETS) {
    row[bucketHeader(b.short)] = durationValue(t.buckets[b.id] ?? 0);
  }
  for (const d of DISPOSITIONS) {
    row[outcomeHeader(d.label)] = t.dispositions[d.id] ?? 0;
  }
  row[NOT_DISPOSITIONED] = t.dispositions[NO_DISPOSITION] ?? 0;
  return row;
}

/** Columns that should render as elapsed time / a percentage, by header name. */
const durationHeaders = () =>
  new Set([
    "talk time",
    "median call",
    "longest call",
    ...BUCKETS.map((b) => bucketHeader(b.short)),
  ]);

/**
 * Write (or update) one day's row in the running `Analytics` tab.
 *
 * Rows are keyed by column A, and values are mapped onto the sheet's OWN header
 * row rather than written positionally: if a disposition is added to the app
 * later, its column is appended on the right instead of shifting every
 * historical row's meaning.
 */
export async function upsertDayRow(
  sheetUrl: string,
  stats: DayStats,
): Promise<void> {
  const id = extractSpreadsheetId(sheetUrl);
  const token = await sheetsToken();
  const sheetId = await ensureNamedTab(token, id, ANALYTICS_TAB);

  // One round trip for both the header row and the day keys.
  const read = (await sheetsApi(
    token,
    `/${id}/values:batchGet?ranges=${encodeURIComponent(`${ANALYTICS_TAB}!1:1`)}` +
      `&ranges=${encodeURIComponent(`${ANALYTICS_TAB}!A2:A`)}`,
  )) as { valueRanges?: { values?: string[][] }[] };

  const headerRow = read.valueRanges?.[0]?.values?.[0] ?? [];
  const keys = read.valueRanges?.[1]?.values ?? [];

  let headers = headerRow.filter((h) => h !== "");
  if (headers.length === 0) {
    headers = analyticsHeaders();
    await sheetsApi(
      token,
      `/${id}/values/${ANALYTICS_TAB}!A1?valueInputOption=RAW`,
      { method: "PUT", body: { values: [headers] } },
    );
  } else if (headers[0] !== "day") {
    // Someone else's tab happens to be called "Analytics" — refuse rather than
    // scribble over it.
    throw new SheetsError(
      "api_error",
      `A tab named "${ANALYTICS_TAB}" already exists in this sheet and isn't the analytics log. Rename it and try again.`,
    );
  } else {
    // Extend, never reorder: anything the app now produces that the sheet has
    // never seen gets appended to the right of the existing columns.
    const missing = analyticsHeaders().filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      headers = [...headers, ...missing];
      await sheetsApi(
        token,
        `/${id}/values/${ANALYTICS_TAB}!A1?valueInputOption=RAW`,
        { method: "PUT", body: { values: [headers] } },
      );
    }
  }

  const record = dayRowRecord(stats);
  const values = [headers.map((h) => record[h] ?? "")];

  const index = keys.findIndex((r) => r[0] === stats.day);
  if (index >= 0) {
    // +2: skip the header row, and convert to a 1-based row number.
    await sheetsApi(
      token,
      `/${id}/values/${ANALYTICS_TAB}!A${index + 2}?valueInputOption=RAW`,
      { method: "PUT", body: { values } },
    );
  } else {
    // Let Sheets pick the first empty row rather than computing one ourselves —
    // it can't collide with a row written since we read the keys.
    await sheetsApi(
      token,
      `/${id}/values/${ANALYTICS_TAB}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: { values } },
    );
  }

  await formatAnalyticsColumns(token, id, sheetId, headers);
}

/**
 * Number-format the duration and percentage columns for the whole column, so
 * rows added later inherit it. Best-effort: formatting is cosmetic and must
 * never cost us the data.
 */
async function formatAnalyticsColumns(
  token: string,
  id: string,
  sheetId: number | null,
  headers: string[],
): Promise<void> {
  if (sheetId == null) return;
  const durations = durationHeaders();
  const requests = headers
    .map((h, i) => {
      const pattern = durations.has(h)
        ? DURATION_FORMAT
        : h === "connect rate"
          ? PERCENT_FORMAT
          : null;
      if (!pattern) return null;
      return {
        repeatCell: {
          range: { sheetId, startColumnIndex: i, endColumnIndex: i + 1, startRowIndex: 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern } } },
          fields: "userEnteredFormat.numberFormat",
        },
      };
    })
    .filter(Boolean);
  if (requests.length === 0) return;
  try {
    await sheetsApi(token, `/${id}:batchUpdate`, {
      method: "POST",
      body: { requests },
    });
  } catch {
    /* formatting is cosmetic — the row still landed */
  }
}

/**
 * Recompute a day and push it to the running tab. A no-op when no call-log
 * sheet is configured, matching how every other sheet writer behaves.
 */
export async function syncAnalyticsDay(day: string): Promise<void> {
  const sheetUrl = await getConsoleSheetUrl();
  if (!sheetUrl) return;
  const tz = await reportingTimezone();
  await upsertDayRow(sheetUrl, await dayStats(day, tz));
}

/**
 * Serialize sheet writes for a given day.
 *
 * Calls can finish back-to-back, and two concurrent upserts for the same day
 * would race on "does this day have a row yet". New work *chains* onto the
 * in-flight write rather than sharing its promise: a caller that arrives
 * mid-write must not adopt that write's result, because it started before this
 * call was committed and would leave the sheet a call behind. Costs at most one
 * extra write; can never leave the sheet stale.
 *
 * Per-instance only — two serverless instances writing at once both produce the
 * same full row, so last-write-wins is harmless.
 */
const inFlight = new Map<string, Promise<void>>();

export function queueAnalyticsDaySync(day: string): Promise<void> {
  const run = (inFlight.get(day) ?? Promise.resolve())
    .catch(() => {})
    .then(() => syncAnalyticsDay(day));
  inFlight.set(
    day,
    run.finally(() => {
      if (inFlight.get(day) === run) inFlight.delete(day);
    }),
  );
  return run;
}

/** Percent/duration cells collected while laying out a day tab. */
type CellFormat = { row: number; col: number; pattern: string };

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** Signed delta helper for the comparison block ("+4", "-2", "0"). */
const delta = (a: number, b: number) => `${a - b >= 0 ? "+" : ""}${a - b}`;

/**
 * Write one day's full breakdown to its own tab, replacing it if this export
 * created it before. Returns the tab name and a deep link to it.
 */
export async function exportDayTab(
  sheetUrl: string,
  stats: DayStats,
): Promise<{ tab: string; url: string }> {
  const id = extractSpreadsheetId(sheetUrl);
  const token = await sheetsToken();
  const tab = `Analytics ${stats.day}`;

  // Does it already exist? Check before creating, so we know whether the
  // ownership marker needs verifying.
  const meta = (await sheetsApi(
    token,
    `/${id}?fields=sheets.properties(title,sheetId)`,
  )) as { sheets?: { properties?: { title?: string; sheetId?: number } }[] };
  const existing = (meta.sheets ?? []).find((s) => s.properties?.title === tab)
    ?.properties;

  let sheetId: number | null;
  if (existing) {
    const head = (await sheetsApi(
      token,
      `/${id}/values/${encodeURIComponent(tab)}!A1:A1`,
    )) as { values?: string[][] };
    const marker = head.values?.[0]?.[0] ?? "";
    if (!String(marker).startsWith(DAY_TAB_MARKER)) {
      throw new SheetsError(
        "api_error",
        `A tab named "${tab}" already exists and wasn't created by this export. Rename or delete it first.`,
      );
    }
    sheetId = existing.sheetId ?? null;
    // Clear values AND formats. `values.clear` leaves number formats behind, so
    // a cell that held a duration yesterday would render a plain count as
    // 0:00:00 today.
    if (sheetId != null) {
      await sheetsApi(token, `/${id}:batchUpdate`, {
        method: "POST",
        body: {
          requests: [
            {
              updateCells: {
                range: { sheetId },
                fields: "userEnteredValue,userEnteredFormat",
              },
            },
          ],
        },
      });
    }
  } else {
    sheetId = await ensureNamedTab(token, id, tab);
  }

  const { rows, formats, boldRows } = buildDayTab(stats);

  await sheetsApi(
    token,
    `/${id}/values/${encodeURIComponent(tab)}!A1?valueInputOption=RAW`,
    { method: "PUT", body: { values: rows } },
  );

  if (sheetId != null) {
    const requests: unknown[] = [
      ...formats.map((f) => ({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: f.row,
            endRowIndex: f.row + 1,
            startColumnIndex: f.col,
            endColumnIndex: f.col + 1,
          },
          cell: {
            userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: f.pattern } },
          },
          fields: "userEnteredFormat.numberFormat",
        },
      })),
      ...boldRows.map((r) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      })),
    ];
    try {
      await sheetsApi(token, `/${id}:batchUpdate`, {
        method: "POST",
        body: { requests },
      });
    } catch {
      /* formatting is cosmetic */
    }
  }

  return { tab, url: tabUrl(id, sheetId) };
}

/**
 * Lay the day out as a value matrix. Sections vary in length (a day may have no
 * dispositions, one rep, twelve active hours), so every offset is computed
 * while building rather than hard-coded.
 */
function buildDayTab(stats: DayStats): {
  rows: (string | number)[][];
  formats: CellFormat[];
  boldRows: number[];
} {
  const t = stats.today;
  const rows: (string | number)[][] = [];
  const formats: CellFormat[] = [];
  const boldRows: number[] = [];

  const push = (...cells: (string | number)[]) => rows.push(cells);
  const blank = () => rows.push([]);
  const title = (text: string) => {
    boldRows.push(rows.length);
    push(text);
  };
  /** Push a label/value row whose value is an elapsed-time duration. */
  const durationRow = (label: string, ms: number) => {
    formats.push({ row: rows.length, col: 1, pattern: DURATION_FORMAT });
    push(label, durationValue(ms));
  };

  boldRows.push(0);
  push(`${DAY_TAB_MARKER}${stats.day}`, `timezone: ${stats.timezone}`);
  push("generated (UTC)", new Date().toISOString().replace("T", " ").slice(0, 19));
  blank();

  title("SUMMARY");
  push("Calls", t.calls);
  push("Connected", t.connects);
  formats.push({ row: rows.length, col: 1, pattern: PERCENT_FORMAT });
  push("Connect rate", t.connectRate);
  durationRow("Talk time", t.totalTalkMs);
  durationRow("Median call", t.medianTalkMs);
  durationRow("Longest call", t.longestTalkMs);
  push("First call", localClock(stats.firstCallAt, stats.timezone));
  push("Last call", localClock(stats.lastCallAt, stats.timezone));
  blank();

  const comparison = (label: string, m: DayMetrics | null) => {
    if (!m) return;
    push(
      label,
      delta(t.calls, m.calls),
      `${pct(t.connectRate)} vs ${pct(m.connectRate)}`,
      `${Math.round((t.totalTalkMs - m.totalTalkMs) / 60000)} min`,
    );
  };
  if (stats.priorDay || stats.trailing7) {
    title("COMPARED TO");
    push("", "Calls", "Connect rate", "Talk time");
    comparison("Previous day", stats.priorDay);
    comparison(
      stats.trailing7 ? `7-day average (${stats.trailing7.daysCounted}d)` : "",
      stats.trailing7,
    );
    blank();
  }

  if (stats.sampleWarning) {
    push("Note", stats.sampleWarning);
    blank();
  }

  const outcomes = Object.entries(t.dispositions).sort((a, b) => b[1] - a[1]);
  if (outcomes.length > 0) {
    title("OUTCOMES");
    push("Outcome", "Calls");
    for (const [key, n] of outcomes) {
      const label =
        key === NO_DISPOSITION
          ? "Not dispositioned"
          : (DISPOSITIONS.find((d) => d.id === key)?.label ?? key);
      push(label, n);
    }
    blank();
  }

  const buckets = BUCKETS.map((b) => ({ b, ms: t.buckets[b.id] ?? 0 }))
    .filter((x) => x.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  if (buckets.length > 0) {
    title("WHERE THE TIME WENT");
    push("Bucket", "Time");
    for (const { b, ms } of buckets) durationRow(b.name, ms);
    blank();
  }

  if (stats.byHour.length > 0) {
    title("CALLS BY HOUR");
    push("Hour", "Calls", "Connects");
    for (const h of stats.byHour) push(`${h.hour}:00`, h.calls, h.connects);
    blank();
  }

  if (stats.byRep.length > 0) {
    title("BY REP");
    push("Rep", "Calls", "Connects", "Connect rate", "Talk time");
    for (const r of stats.byRep) {
      formats.push({ row: rows.length, col: 3, pattern: PERCENT_FORMAT });
      formats.push({ row: rows.length, col: 4, pattern: DURATION_FORMAT });
      push(r.repName, r.calls, r.connects, r.connectRate, durationValue(r.totalTalkMs));
    }
    blank();
  }

  if (stats.note) {
    title("JOURNAL");
    push("Note", stats.note.note);
    push("Tags", stats.note.tags.join(", "));
  }

  return { rows, formats, boldRows };
}
