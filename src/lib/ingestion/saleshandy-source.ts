import { desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { ingestionBatches, leads } from "@/db/schema";
import type { ColumnMapping, SkippedRecord } from "@/db/schema";
import type { BatchSummary } from "./types";
import { validateBatch, commitBatch } from "./service";
import { assignBatchLeads } from "@/lib/campaigns/service";
import {
  listProspects,
  prospectFields,
  prospectTags,
  saleshandyConfigured,
  type SaleshandyProspect,
} from "@/lib/saleshandy/client";
import {
  getSaleshandyConfig,
  advanceSaleshandyWatermark,
  setSaleshandyResumePage,
} from "@/lib/settings";

/**
 * Saleshandy lead source.
 *
 * Pulls prospects out of Saleshandy (the lead-gen system) and runs them through
 * the same shared gate every other ingestion path uses — phone → E.164, DNC /
 * suppression, contact-ledger dedupe, audit. Nothing here re-implements
 * validation; it only adapts Saleshandy's shape to `validateBatch`.
 *
 * Two things make the adaptation clean:
 *  - A prospect's data is a key/value `attributes` list keyed by human-readable
 *    names ("Phone Number", "Company", …), so those names act exactly like CSV
 *    headers and the existing ColumnMapping machinery works unchanged.
 *  - `GET /v1/prospects` has no "modified since" filter, so incremental sync is
 *    newest-first paging that stops at a stored `createdAt` watermark.
 *
 * Idempotent: the contact ledger prevents re-importing a number even if the
 * watermark is reset and the whole history is re-walked.
 */

/** Bound one pass so a huge account can't run the route past its time limit. */
const MAX_PAGES = 100;
const PAGE_SIZE = 100;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Attribute names we'll accept as the phone column, best first. */
const PHONE_KEYS = [
  "phonenumber",
  "phone",
  "mobile",
  "mobilenumber",
  "directdial",
  "cell",
  "cellphone",
  "telephone",
  "tel",
  "workphone",
  "contactnumber",
];

/**
 * Find the attribute holding the phone. Prefers Saleshandy's stock "Phone Number"
 * but falls back to a custom field (accounts that enrich phones often land them in
 * "Direct Dial" or "Mobile"), so we don't silently import a list with no numbers.
 */
function resolvePhoneKey(fieldSets: Record<string, string>[]): string | null {
  const seen = new Set<string>();
  for (const f of fieldSets) for (const k of Object.keys(f)) seen.add(k);
  const keys = [...seen];
  for (const want of PHONE_KEYS) {
    const hit = keys.find((k) => norm(k) === want);
    if (hit) return hit;
  }
  // Last resort: any attribute whose name merely contains "phone".
  return keys.find((k) => norm(k).includes("phone")) ?? null;
}

/**
 * Saleshandy stores phones as international digits with the country code but no
 * leading "+" ("17135570816", "393177541389"). Bare digits like that are parsed
 * against the default region (US), so non-US numbers are read as malformed US
 * ones and rejected. Restoring the "+" makes them parse as international.
 *
 * Only applied at 11+ digits: a bare 10-digit string is a national US number and
 * must keep falling through to the US default. For NANP, the 11th digit *is* the
 * country code, so prefixing is correct there too.
 */
function restorePlus(raw: string): string {
  const v = raw.trim();
  if (v.startsWith("+")) return v;
  const digits = v.replace(/[\s().-]/g, "");
  return /^\d{11,15}$/.test(digits) ? `+${digits}` : v;
}

/** Synthetic columns the mapping points at (composed from several attributes). */
function decorate(f: Record<string, string>, p: SaleshandyProspect): Record<string, string> {
  const first = f["First Name"] ?? "";
  const last = f["Last Name"] ?? "";
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) f["_name"] = full;

  f["_source"] = "saleshandy";

  // A compact brief for the rep's lead card — title, email, and anything the
  // account tagged the prospect with.
  const tags = (p.tags ?? []).map((t) => t?.name).filter(Boolean);
  const bits = [
    f["Job Title"],
    f["Email"],
    f["LinkedIn"],
    tags.length ? `tags: ${tags.join(", ")}` : null,
  ].filter(Boolean);
  if (bits.length) f["_notes"] = bits.join(" · ");

  return f;
}

export type SaleshandyImportResult = {
  summary: BatchSummary;
  imported: number; // eligible leads created + queued this pass
  batchId: string | null;
  /** One entry per destination campaign this pass filled. */
  batches?: { campaignId: string | null; batchId: string; imported: number }[];
  /** Prospects scanned in Saleshandy before filtering. */
  scanned: number;
  /** Dropped before the gate because Saleshandy holds no phone for them. */
  skippedNoPhone: number;
  /** Dropped because they don't carry the configured tag. */
  skippedNotTagged: number;
  /** True when MAX_PAGES stopped the walk early — run again to continue. */
  truncated: boolean;
  /** Which attribute we read the phone from (null ⇒ none found at all). */
  phoneField: string | null;
};

const EMPTY_SUMMARY: BatchSummary = {
  rowCount: 0,
  eligible: 0,
  quarantined: 0,
  blocked: 0,
  invalid: 0,
  duplicates: 0,
};

function empty(extra: Partial<SaleshandyImportResult>): SaleshandyImportResult {
  return {
    summary: EMPTY_SUMMARY,
    imported: 0,
    batchId: null,
    scanned: 0,
    skippedNoPhone: 0,
    skippedNotTagged: 0,
    truncated: false,
    phoneField: null,
    ...extra,
  };
}

export type ImportReportRow = {
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  linkedin: string | null;
};

export type ImportReport = {
  batchId: string;
  at: string;
  /** Landed in the queue. */
  imported: ImportReportRow[];
  /** Already in the contact ledger — seen, deliberately not re-imported. */
  alreadyKnown: ImportReportRow[];
  /** Never reached the gate: Saleshandy holds no phone for them. */
  noPhone: ImportReportRow[];
};

/**
 * The last Saleshandy import, itemised.
 *
 * Only the phone-less records need storing (see `skippedRecords`); everything
 * else the batch touched is still in `leads`, so the two halves are read back
 * from the places they already live rather than duplicated into a report blob.
 */
export async function getLastImportReport(): Promise<ImportReport | null> {
  const [batch] = await db
    .select({
      id: ingestionBatches.id,
      createdAt: ingestionBatches.createdAt,
      skipped: ingestionBatches.skippedRecords,
    })
    .from(ingestionBatches)
    .where(like(ingestionBatches.filename, "saleshandy:%"))
    .orderBy(desc(ingestionBatches.createdAt))
    .limit(1);
  if (!batch) return null;

  const rows = await db
    .select({
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      company: leads.company,
      status: leads.validationStatus,
    })
    .from(leads)
    .where(eq(leads.ingestionBatchId, batch.id))
    .orderBy(leads.name);

  const pick = (status: string): ImportReportRow[] =>
    rows
      .filter((r) => r.status === status)
      .map((r) => ({
        name: r.name,
        phone: r.phone,
        email: r.email,
        company: r.company,
        linkedin: null,
      }));

  return {
    batchId: batch.id,
    at: batch.createdAt.toISOString(),
    imported: pick("eligible"),
    alreadyKnown: pick("duplicate"),
    noPhone: (batch.skipped ?? []).map((s) => ({
      name: s.name,
      phone: null,
      email: s.email,
      company: s.company,
      linkedin: s.linkedin,
    })),
  };
}

export async function importSaleshandyProspects(params?: {
  uploadedBy?: string;
  /** Ignore the stored watermark and re-walk the full history (still deduped). */
  full?: boolean;
}): Promise<SaleshandyImportResult> {
  if (!saleshandyConfigured()) {
    throw new Error("SALESHANDY_API_KEY is not set");
  }

  const cfg = await getSaleshandyConfig();
  const watermark = params?.full ? null : cfg.watermark;
  const cutoff = watermark ? Date.parse(watermark) : null;
  const wantTag = cfg.tag?.toLowerCase() ?? null;

  // Routes are matched lowercased, like the tag filter, so casing in Saleshandy
  // never silently costs a match.
  const routes = cfg.routes.map((r) => ({
    tag: r.tag.toLowerCase(),
    campaignId: r.campaignId,
  }));

  /**
   * Which campaign this prospect belongs in, or null to skip it.
   *
   * Order matters: a routed tag is checked before the filter, so giving a list
   * its own campaign is enough to import it — you don't also have to remember to
   * widen the tag filter. Unrouted prospects fall to the default campaign, and
   * are skipped entirely when there isn't one, because a lead with no campaign
   * is invisible to every rep and would just accumulate unseen.
   */
  const routeFor = (p: SaleshandyProspect): string | null => {
    const tags = prospectTags(p);
    for (const r of routes) if (tags.includes(r.tag)) return r.campaignId;
    if (wantTag && !tags.includes(wantTag)) return null;
    return cfg.campaignId;
  };

  /** prospect id → campaign, decided during the walk and reused when batching. */
  const routeOf = new Map<string, string>();

  // ── Walk newest-first until we reach the watermark or run out of pages ──
  //
  // A pass that hits MAX_PAGES resumes from the page it stopped on rather than
  // restarting at 1, because the walk always descends from the newest record:
  // re-running from the top would just re-cover the same window and never reach
  // the older prospects below it. Paging is newest-first, so prospects created
  // between passes only push records further down — a resumed page can overlap
  // what we already scanned (harmless; the ledger dedupes) but can't skip past.
  const startPage = params?.full ? 1 : (cfg.resumePage ?? 1);

  const collected: SaleshandyProspect[] = [];
  let newest: string | null = null;
  let scanned = 0;
  let skippedNotTagged = 0;
  let truncated = false;
  let lastPage = startPage;

  // A resumed pass never sees page 1, so it can't observe the newest createdAt
  // on its own. Peek at the top so the watermark we eventually store is the real
  // high-water mark and not merely the newest record on the resumed page.
  if (startPage > 1) {
    const head = await listProspects({ page: 1, pageSize: 1, sort: "DESC" });
    newest = head[0]?.createdAt ?? null;
  }

  for (let page = startPage; page < startPage + MAX_PAGES; page++) {
    lastPage = page;
    const batch = await listProspects({ page, pageSize: PAGE_SIZE, sort: "DESC" });
    if (batch.length === 0) break;

    let hitWatermark = false;
    for (const p of batch) {
      scanned++;
      if (p.createdAt && (!newest || Date.parse(p.createdAt) > Date.parse(newest))) {
        newest = p.createdAt;
      }
      // Sorted DESC, so the first record at/older than the watermark ends the walk.
      if (cutoff != null && p.createdAt && Date.parse(p.createdAt) <= cutoff) {
        hitWatermark = true;
        break;
      }
      // Routing decides both *whether* to take a prospect and *where* it goes.
      // A routed tag always wins over the tag filter: the filter exists to keep
      // junk out of the default campaign, not to hide a list that has been
      // explicitly given a campaign of its own.
      const target = routeFor(p);
      if (!target) {
        skippedNotTagged++;
        continue;
      }
      collected.push(p);
      routeOf.set(p.id, target);
    }

    if (hitWatermark) break;
    if (batch.length < PAGE_SIZE) break; // last page
    if (page === startPage + MAX_PAGES - 1) truncated = true;
  }

  // Advancing the watermark declares "everything newer than this is imported",
  // which is only true once the walk actually reached the watermark or the end
  // of the history. A truncated pass stopped short, so it banks its position
  // instead and leaves the watermark alone for the next pass to finish the job.
  const commitProgress = async () => {
    if (truncated) {
      await setSaleshandyResumePage(lastPage + 1);
      return;
    }
    await setSaleshandyResumePage(null);
    await advanceSaleshandyWatermark(newest);
  };

  if (collected.length === 0) {
    // Still record progress — everything scanned was already known or filtered out.
    await commitProgress();
    return empty({ scanned, skippedNotTagged, truncated });
  }

  // ── Adapt to the shared gate ──
  // `_campaign` rides along as a hidden field so the routing decision survives
  // into batching. It is never in the ColumnMapping, so it can't reach `leads`.
  const fieldSets = collected.map((p) => {
    const f = decorate(prospectFields(p), p);
    const target = routeOf.get(p.id);
    if (target) f["_campaign"] = target;
    return f;
  });
  const phoneKey = resolvePhoneKey(fieldSets);

  if (!phoneKey) {
    // No phone attribute anywhere in the pull. Importing would just create a pile
    // of `invalid` leads, so stop and say why — and don't advance the watermark,
    // since these prospects become importable the moment phones are enriched.
    return empty({
      scanned,
      skippedNoPhone: collected.length,
      skippedNotTagged,
      truncated,
    });
  }

  // Drop phone-less prospects before the gate. They'd validate as `invalid` and
  // sit in `leads` forever without ever being dialable; Saleshandy stays their
  // system of record until someone enriches a number.
  const dialable = fieldSets.filter((f) => (f[phoneKey] ?? "").trim() !== "");
  const skippedNoPhone = fieldSets.length - dialable.length;
  for (const f of dialable) f[phoneKey] = restorePlus(f[phoneKey]);

  // Name them, don't just count them. These never reach `leads`, so the batch
  // row is the only record that they were seen and why they were passed over —
  // which is what turns "54 skipped" into a list someone can go enrich.
  const skipped: SkippedRecord[] = fieldSets
    .filter((f) => (f[phoneKey] ?? "").trim() === "")
    .map((f) => ({
      reason: "no_phone" as const,
      name: f["_name"] ?? null,
      email: f["Email"] ?? null,
      company: f["Company"] ?? null,
      linkedin: f["LinkedIn"] ?? null,
    }));

  if (dialable.length === 0) {
    await commitProgress();
    return empty({ scanned, skippedNoPhone, skippedNotTagged, truncated, phoneField: phoneKey });
  }

  const mapping: ColumnMapping = {
    phone: phoneKey,
    source: "_source",
  };
  const has = (k: string) => dialable.some((f) => f[k] != null);
  if (has("_name")) mapping.name = "_name";
  if (has("Company")) mapping.company = "Company";
  if (has("Company Domain")) mapping.website = "Company Domain";
  if (has("_notes")) mapping.notes = "_notes";

  // One batch per destination campaign. Batches are the unit `assignBatchLeads`
  // works on, so prospects bound for different campaigns cannot share one —
  // they'd all land in whichever campaign was passed.
  const byCampaign = new Map<string, Record<string, string>[]>();
  for (const f of dialable) {
    const target = f["_campaign"] ?? "";
    if (!byCampaign.has(target)) byCampaign.set(target, []);
    byCampaign.get(target)!.push(f);
  }

  // The no-phone list isn't attributable to one campaign, so it rides on the
  // first batch rather than being duplicated across every one of them.
  let skippedAttached = false;
  const batches: { campaignId: string | null; batchId: string; imported: number }[] = [];
  let totalEligible = 0;
  const totals: BatchSummary = {
    rowCount: 0,
    eligible: 0,
    quarantined: 0,
    blocked: 0,
    invalid: 0,
    duplicates: 0,
  };

  for (const [campaignId, rows] of byCampaign) {
    // b2bMode matches the Sheet source: these are business prospects already in
    // a cold-email sequence, so the consent basis is `b2b` rather than free text.
    const validated = await validateBatch(rows, mapping, { b2bMode: true });

    const label = cfg.routes.find((r) => r.campaignId === campaignId)?.tag;
    const batchId = await commitBatch({
      filename: `saleshandy:${label ?? cfg.tag ?? "all"}`,
      uploadedBy: params?.uploadedBy ?? "saleshandy-import",
      mapping,
      validated,
      skipped: skippedAttached ? [] : skipped,
    });
    skippedAttached = true;

    await assignBatchLeads(batchId, campaignId || null);

    batches.push({
      campaignId: campaignId || null,
      batchId,
      imported: validated.summary.eligible,
    });
    totalEligible += validated.summary.eligible;
    for (const k of Object.keys(totals) as (keyof BatchSummary)[]) {
      totals[k] += validated.summary[k] ?? 0;
    }
  }

  // Only record progress once every batch is committed — a throw above leaves
  // the window open so the next pass retries the same prospects.
  await commitProgress();

  return {
    summary: totals,
    imported: totalEligible,
    // The first batch stays the headline id so existing callers (the panel's
    // report link) keep working; `batches` has the full per-campaign split.
    batchId: batches[0]?.batchId ?? null,
    batches,
    scanned,
    skippedNoPhone,
    skippedNotTagged,
    truncated,
    phoneField: phoneKey,
  };
}
