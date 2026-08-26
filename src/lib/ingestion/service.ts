import { inArray, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  leads,
  ingestionBatches,
  auditLog,
  columnMappingTemplates,
  type SkippedRecord,
} from "@/db/schema";
import { normalizePhone } from "./phone";
import { timezoneForAreaCode } from "./timezone";
import { getDncScrubber, checkInternalSuppression } from "./dnc";
import { classifyConsent, isCallableBasisType } from "./consent";
import { phonesInLedger, recordFound } from "@/lib/pipeline/ledger";
import type {
  ColumnMapping,
  RowResult,
  BatchSummary,
  ValidatedBatch,
  MappableField,
} from "./types";

/**
 * LeadIngestionService — the single shared validation-and-scrub gate.
 *
 * Per spec addendum, ALL ingestion paths (CSV, CRM sync, REST API, manual) must
 * converge here; do not reimplement validation per path. CSV is its first caller.
 *
 * The gate is split in two so it maps onto the pre-import-report UX:
 *   1. validateBatch() — pure of lead writes. Runs every row through every check
 *      and returns per-row results + a summary. Nothing becomes dial-eligible.
 *   2. commitBatch()   — persists the (already validated) rows after the user
 *      confirms the report. Only `eligible` rows are dial-eligible; everything
 *      else is retained with its rejection reason for the audit trail.
 */

function pick(
  raw: Record<string, string>,
  mapping: ColumnMapping,
  field: MappableField,
): string | null {
  const header = mapping[field];
  if (!header) return null;
  const v = raw[header];
  return v != null && String(v).trim() !== "" ? String(v).trim() : null;
}

/**
 * Options for the shared gate.
 *  - b2bMode: business-to-business dialing (e.g. the Google-Sheet source). Skips
 *    the consent-basis quarantine by assigning the callable `b2b` basis instead
 *    of classifying free text, so phone-valid business rows become eligible. All
 *    other gates (phone required, DNC/suppression, dedupe) still run. Never infer
 *    b2b from text — it is only set here, explicitly.
 */
export type ValidateOptions = { b2bMode?: boolean };

export async function validateBatch(
  rawRows: Record<string, string>[],
  mapping: ColumnMapping,
  opts?: ValidateOptions,
): Promise<ValidatedBatch> {
  const b2bMode = opts?.b2bMode ?? false;
  // First pass: extract + normalize phone for every row.
  type Draft = Omit<RowResult, "status" | "reason" | "dncStatus"> & {
    phoneReason: string | null;
  };
  const drafts: Draft[] = rawRows.map((raw, rowIndex) => {
    const rawPhone = pick(raw, mapping, "phone") ?? "";
    const parsed = normalizePhone(rawPhone);
    const phoneE164 = parsed.ok ? parsed.e164 : null;
    const explicitTz = pick(raw, mapping, "timezone");
    const derivedTz =
      explicitTz ??
      (parsed.ok ? timezoneForAreaCode(parsed.countryAreaCode) : null);
    return {
      rowIndex,
      raw,
      phoneE164,
      phoneReason: parsed.ok ? null : parsed.reason,
      name: pick(raw, mapping, "name"),
      company: pick(raw, mapping, "company"),
      website: pick(raw, mapping, "website"),
      timezone: derivedTz,
      source: pick(raw, mapping, "source"),
      // B2B: stamp the callable `b2b` basis; otherwise classify the raw consent text.
      consentBasis: b2bMode ? "B2B" : pick(raw, mapping, "consentBasis"),
      consentBasisType: b2bMode
        ? ("b2b" as const)
        : classifyConsent(pick(raw, mapping, "consentBasis")).type,
      notes: pick(raw, mapping, "notes"),
    };
  });

  // Batch the external lookups over the set of unique valid phones.
  const validPhones = Array.from(
    new Set(drafts.filter((d) => d.phoneE164).map((d) => d.phoneE164 as string)),
  );
  const scrubber = getDncScrubber();
  const [dncMap, suppressed, existingEligible, ledgerPhones] = await Promise.all([
    scrubber.scrub(validPhones),
    checkInternalSuppression(validPhones),
    existingEligiblePhones(validPhones),
    phonesInLedger(validPhones),
  ]);

  // Second pass: assign a single status per row via a fixed precedence.
  const seenInFile = new Set<string>();
  const rows: RowResult[] = drafts.map((d) => {
    const dncStatus: RowResult["dncStatus"] = d.phoneE164
      ? (dncMap.get(d.phoneE164) ?? "clear")
      : "unknown";

    let status: RowResult["status"];
    let reason: string | null = null;

    if (!d.phoneE164) {
      // 1. invalid phone — can't do anything else without a valid number.
      status = "invalid";
      reason = d.phoneReason ?? "invalid phone";
    } else if (dncStatus === "listed" || suppressed.has(d.phoneE164)) {
      // 2. blocked — on DNC / internal suppression.
      status = "blocked";
      reason = suppressed.has(d.phoneE164)
        ? "on internal suppression / opt-out list"
        : "on DNC registry";
    } else if (!isCallableBasisType(d.consentBasisType)) {
      // 3. quarantined — no recognized/callable consent basis; retained but never
      // dialable. Distinguishes "nothing supplied" from "supplied but invalid".
      status = "quarantined";
      reason = d.consentBasis
        ? `unrecognized consent basis: "${d.consentBasis}"`
        : "missing consent basis";
    } else if (
      seenInFile.has(d.phoneE164) ||
      existingEligible.has(d.phoneE164) ||
      ledgerPhones.has(d.phoneE164)
    ) {
      // 4. duplicate — already in this file, already an eligible lead, or already
      // in the persistent contact ledger (found/called in an earlier session).
      status = "duplicate";
      reason = existingEligible.has(d.phoneE164)
        ? "duplicate: already an eligible lead"
        : ledgerPhones.has(d.phoneE164)
          ? "phone already in contact ledger"
          : "duplicate within uploaded file";
    } else {
      // 5. eligible — passed every check.
      status = "eligible";
    }

    // Only an eligible row claims the number as the in-file "keeper", so a later
    // eligible row is the duplicate — not the other way around, and a quarantined
    // or blocked row never shadows a genuinely callable one with the same number.
    if (status === "eligible") seenInFile.add(d.phoneE164 as string);

    return {
      rowIndex: d.rowIndex,
      raw: d.raw,
      phoneE164: d.phoneE164,
      name: d.name,
      company: d.company,
      website: d.website,
      timezone: d.timezone,
      source: d.source,
      consentBasis: d.consentBasis,
      consentBasisType: d.consentBasisType,
      notes: d.notes,
      dncStatus,
      status,
      reason,
    };
  });

  return { rows, summary: summarize(rows) };
}

function summarize(rows: RowResult[]): BatchSummary {
  const s: BatchSummary = {
    rowCount: rows.length,
    eligible: 0,
    quarantined: 0,
    blocked: 0,
    invalid: 0,
    duplicates: 0,
  };
  for (const r of rows) {
    if (r.status === "eligible") s.eligible++;
    else if (r.status === "quarantined") s.quarantined++;
    else if (r.status === "blocked") s.blocked++;
    else if (r.status === "invalid") s.invalid++;
    else if (r.status === "duplicate") s.duplicates++;
  }
  return s;
}

async function existingEligiblePhones(phones: string[]): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const rows = await db
    .select({ phone: leads.phone })
    .from(leads)
    .where(inArray(leads.phone, phones));
  // Only eligible existing leads count as duplicates (a previously quarantined
  // number should be importable once a consent basis is supplied).
  return new Set(
    rows
      .filter((r): r is { phone: string } => r.phone != null)
      .map((r) => r.phone),
  );
}

/**
 * Persist a validated batch. Creates the ingestion_batches row, inserts every
 * lead row with its validation outcome, and writes one immutable audit record.
 * Returns the batch id.
 */
export async function commitBatch(params: {
  filename: string;
  uploadedBy?: string;
  mapping: ColumnMapping;
  validated: ValidatedBatch;
  /**
   * Source records the caller dropped before validation. They never become
   * leads, so this is the only place they're recorded — see `skippedRecords`.
   */
  skipped?: SkippedRecord[];
}): Promise<string> {
  const { filename, uploadedBy = "dev", mapping, validated, skipped } = params;
  const { rows, summary } = validated;

  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(ingestionBatches)
      .values({
        filename,
        uploadedBy,
        rowCount: summary.rowCount,
        eligibleCount: summary.eligible,
        quarantinedCount: summary.quarantined,
        blockedCount: summary.blocked,
        invalidCount: summary.invalid,
        duplicateCount: summary.duplicates,
        status: "committed",
        columnMapping: mapping,
        skippedRecords: skipped?.length ? skipped : null,
      })
      .returning({ id: ingestionBatches.id });

    if (rows.length > 0) {
      const inserted = await tx
        .insert(leads)
        .values(
          rows.map((r) => ({
            phone: r.phoneE164,
            name: r.name,
            company: r.company,
            website: r.website,
            timezone: r.timezone,
            source: r.source,
            consentBasis: r.consentBasis,
            consentBasisType: r.consentBasisType,
            // has_basis only when the classified basis actually permits calling;
            // "unrecognized" text is present but not a basis.
            consentStatus: isCallableBasisType(r.consentBasisType)
              ? ("has_basis" as const)
              : ("missing" as const),
            dncStatus: r.dncStatus,
            validationStatus: r.status,
            validationReason: r.reason,
            ingestionBatchId: batch.id,
            notes: r.notes,
            rawSourceRow: r.raw,
          })),
        )
        .returning({
          id: leads.id,
          phone: leads.phone,
          validationStatus: leads.validationStatus,
        });

      // Persist "found" dedupe permanently: upsert a contact-ledger row for every
      // eligible inserted lead, so the number is never re-found across sessions
      // even if this lead row is later quarantined/deleted (spec §2).
      const foundEligible = inserted
        .filter((l) => l.validationStatus === "eligible" && l.phone)
        .map((l) => ({ phone: l.phone as string, leadId: l.id }));
      await recordFound(foundEligible, tx);
    }

    await tx.insert(auditLog).values({
      event: "ingest.batch.committed",
      batchId: batch.id,
      detail: { filename, summary },
    });

    return batch.id;
  });
}

/** Load a previously saved per-vendor mapping template, if any. */
export async function getMappingTemplate(
  vendor: string,
): Promise<ColumnMapping | null> {
  const [row] = await db
    .select({ mapping: columnMappingTemplates.mapping })
    .from(columnMappingTemplates)
    .where(eq(columnMappingTemplates.vendor, vendor))
    .limit(1);
  return row?.mapping ?? null;
}

/** Upsert the per-vendor mapping so repeat uploads from the same source auto-map. */
export async function saveMappingTemplate(
  vendor: string,
  mapping: ColumnMapping,
): Promise<void> {
  await db
    .insert(columnMappingTemplates)
    .values({ vendor, mapping })
    .onConflictDoUpdate({
      target: columnMappingTemplates.vendor,
      set: { mapping, updatedAt: sql`now()` },
    });
}

/** Suggest a mapping by matching source headers to lead fields heuristically. */
export function autoSuggestMapping(headers: string[]): Partial<ColumnMapping> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const patterns: Record<MappableField, string[]> = {
    phone: ["phone", "phonenumber", "mobile", "cell", "tel", "telephone"],
    name: ["name", "fullname", "contact", "contactname", "firstname"],
    company: ["company", "organization", "org", "business", "account"],
    website: ["website", "url", "site", "domain", "companyurl", "companywebsite", "web"],
    timezone: ["timezone", "tz"],
    source: ["source", "leadsource", "channel", "list"],
    consentBasis: ["consent", "consentbasis", "optin", "permission", "basis"],
    notes: ["notes", "note", "comment", "comments"],
  };
  const result: Partial<ColumnMapping> = {};
  const used = new Set<string>();
  for (const field of Object.keys(patterns) as MappableField[]) {
    const match = headers.find(
      (h) => !used.has(h) && patterns[field].includes(norm(h)),
    );
    if (match) {
      result[field] = match;
      used.add(match);
    }
  }
  return result;
}
