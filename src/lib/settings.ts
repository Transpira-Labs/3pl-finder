import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

/**
 * Tiny key/value settings store (app_settings table) for singleton config the
 * admin sets in the UI rather than via env. Used by the central-Sheet ingester.
 */

export const SETTINGS_KEYS = {
  // The Google Sheet every finished Call-Console call is appended to (both the
  // dialer/rep DB path and the solo stopwatch). Set by the admin in the UI so no
  // env/redeploy is needed; empty ⇒ auto-log off. See src/lib/sheets-server.ts.
  consoleSheetUrl: "console_sheet_url",
  // IANA timezone that defines where a "calling day" starts for Call Analytics.
  // call_attempts.startedAt is UTC, so without this an 8pm ET call would be
  // filed under the next day. Defaults to America/New_York.
  analyticsTimezone: "analytics_timezone",
  // Saleshandy lead source (the API key itself stays in env, like Twilio's).
  saleshandyCampaignId: "saleshandy_campaign_id",
  saleshandyTag: "saleshandy_tag",
  saleshandyWatermark: "saleshandy_watermark",
  saleshandyResumePage: "saleshandy_resume_page",
  // Tag → campaign routing, JSON [{tag, campaignId}]. One pass can now fill
  // several campaigns, which the single tag+campaign pair could not: the
  // watermark is global, so importing one tag advanced past every other tag's
  // prospects and skipped them for good. Routing them in the same walk is what
  // makes per-campaign lists safe.
  saleshandyRoutes: "saleshandy_routes",
  // Personal cells an inbound call (a lead returning a voicemail) is forwarded
  // to. Comma-separated E.164, rung simultaneously. Empty ⇒ inbound is off and
  // /api/voice/inbound hangs up rather than dialing nowhere. In settings rather
  // than env so whoever is on call can change without a redeploy.
  inboundForwardNumbers: "inbound_forward_numbers",
} as const;

/**
 * Where inbound calls ring. Stored as one comma-separated string; returned split
 * and cleaned so callers never parse it themselves.
 *
 * Only E.164 survives the round trip — `/api/voice/inbound` puts these straight
 * into TwiML, and a malformed entry would make Twilio fail the whole `<Dial>`,
 * dropping a real callback. Bad entries are dropped here rather than saved.
 */
export async function getInboundForwardNumbers(): Promise<string[]> {
  const raw = await getSetting(SETTINGS_KEYS.inboundForwardNumbers);
  if (!raw) return [];
  return raw
    .split(",")
    .map((n) => n.trim())
    .filter((n) => /^\+[1-9]\d{7,14}$/.test(n));
}

export async function setInboundForwardNumbers(numbers: string[]): Promise<void> {
  const clean = numbers
    .map((n) => n.trim())
    .filter((n) => /^\+[1-9]\d{7,14}$/.test(n));
  await setSetting(
    SETTINGS_KEYS.inboundForwardNumbers,
    clean.length ? clean.join(",") : null,
  );
}

/**
 * Non-secret config for the Saleshandy prospect pull. The watermark is the
 * `createdAt` of the newest prospect we've already imported — the pull sorts
 * newest-first and stops there, so each pass only walks genuinely new records.
 */
/** Send prospects carrying `tag` to `campaignId` instead of the default. */
export type SaleshandyRoute = { tag: string; campaignId: string };

export type SaleshandyConfig = {
  /**
   * Where prospects land when no route matches. Null ⇒ unrouted prospects are
   * skipped rather than imported unassigned, since a lead with no campaign is
   * invisible to every rep.
   */
  campaignId: string | null;
  /** Only import prospects carrying this Saleshandy tag. Empty ⇒ import all. */
  tag: string | null;
  /**
   * Tag → campaign overrides, checked in order; first match wins. A prospect
   * carrying several routed tags therefore lands in the topmost one rather than
   * being duplicated across campaigns.
   */
  routes: SaleshandyRoute[];
  watermark: string | null;
  /**
   * Where to resume a walk that hit the per-pass page cap. Null ⇒ start at page 1.
   * Set only while a deep history is still being worked through; the watermark
   * stays put until the walk finally completes, so the two never disagree.
   */
  resumePage: number | null;
};

/** Parse the stored routes JSON, dropping anything malformed rather than throwing. */
function parseRoutes(raw: string | null): SaleshandyRoute[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r) => ({
        tag: String((r as SaleshandyRoute)?.tag ?? "").trim(),
        campaignId: String((r as SaleshandyRoute)?.campaignId ?? "").trim(),
      }))
      .filter((r) => r.tag && r.campaignId);
  } catch {
    return [];
  }
}

export async function setSaleshandyRoutes(routes: SaleshandyRoute[]): Promise<void> {
  const clean = routes
    .map((r) => ({ tag: r.tag?.trim() ?? "", campaignId: r.campaignId?.trim() ?? "" }))
    .filter((r) => r.tag && r.campaignId);
  await setSetting(
    SETTINGS_KEYS.saleshandyRoutes,
    clean.length ? JSON.stringify(clean) : null,
  );
}

export async function getSaleshandyConfig(): Promise<SaleshandyConfig> {
  const [campaignId, tag, routes, watermark, resumePage] = await Promise.all([
    getSetting(SETTINGS_KEYS.saleshandyCampaignId),
    getSetting(SETTINGS_KEYS.saleshandyTag),
    getSetting(SETTINGS_KEYS.saleshandyRoutes),
    getSetting(SETTINGS_KEYS.saleshandyWatermark),
    getSetting(SETTINGS_KEYS.saleshandyResumePage),
  ]);
  const page = Number(resumePage);
  return {
    campaignId: campaignId?.trim() || null,
    tag: tag?.trim() || null,
    routes: parseRoutes(routes),
    watermark: watermark?.trim() || null,
    resumePage: Number.isInteger(page) && page > 1 ? page : null,
  };
}

/** Remember where a truncated walk stopped, or clear it once it completes. */
export async function setSaleshandyResumePage(page: number | null): Promise<void> {
  await setSetting(
    SETTINGS_KEYS.saleshandyResumePage,
    page && page > 1 ? String(page) : null,
  );
}

export async function setSaleshandyConfig(
  patch: Partial<Pick<SaleshandyConfig, "campaignId" | "tag">>,
): Promise<void> {
  if ("campaignId" in patch) {
    await setSetting(SETTINGS_KEYS.saleshandyCampaignId, patch.campaignId?.trim() || null);
  }
  if ("tag" in patch) {
    await setSetting(SETTINGS_KEYS.saleshandyTag, patch.tag?.trim() || null);
  }
}

/**
 * Advance (never rewind) the import watermark. Guarded so an out-of-order or
 * partial pass can't re-open a window we've already walked.
 */
export async function advanceSaleshandyWatermark(newest: string | null): Promise<void> {
  if (!newest) return;
  const current = await getSetting(SETTINGS_KEYS.saleshandyWatermark);
  if (current && Date.parse(current) >= Date.parse(newest)) return;
  await setSetting(SETTINGS_KEYS.saleshandyWatermark, newest);
}

/** Clear the watermark so the next pass re-walks the full prospect history. */
export async function resetSaleshandyWatermark(): Promise<void> {
  await setSetting(SETTINGS_KEYS.saleshandyWatermark, null);
  // Start the re-walk from the top, not from wherever a previous one stalled.
  await setSetting(SETTINGS_KEYS.saleshandyResumePage, null);
}

/**
 * The call-log Sheet URL. Read on every finished call (server appends the row)
 * and by the admin Settings panel. Null/empty means auto-log is off.
 */
export async function getConsoleSheetUrl(): Promise<string | null> {
  const raw = await getSetting(SETTINGS_KEYS.consoleSheetUrl);
  const trimmed = raw?.trim();
  return trimmed || null;
}

export async function setConsoleSheetUrl(url: string | null): Promise<void> {
  await setSetting(SETTINGS_KEYS.consoleSheetUrl, url?.trim() || null);
}

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: sql`now()` },
    });
}

// The legacy single-sheet config (lead_sheet_url/tab/campaign_id) is now migrated
// into the lead_sheets table on first read — see src/lib/lead-sheets.ts. The keys
// above are kept only so that migration can find + clear them.
