import { importSaleshandyProspects } from "@/lib/ingestion/saleshandy-source";
import { saleshandyConfigured } from "@/lib/saleshandy/client";
import { heartbeat, isServiceEnabled } from "@/lib/services";

/**
 * One ingestion pass: pull Saleshandy prospects created since the stored
 * watermark and run them through the shared validation gate.
 *
 * Shared between the long-running local worker (`npm run ingest`) and the Vercel
 * cron route (`/api/cron/ingest`), so hosted and local runs do the same thing —
 * only the schedule differs.
 *
 * Idempotent: the watermark plus the contact ledger both prevent re-importing a
 * prospect, so running it twice is harmless.
 */

export type IngestPassResult = {
  skipped: "disabled" | "not-configured" | null;
  imported: number;
  /** Prospects Saleshandy has no phone number for — not importable as leads. */
  skippedNoPhone: number;
  errors: string[];
};

export async function runIngestPass(
  uploadedBy = "ingest-worker",
): Promise<IngestPassResult> {
  const enabled = await isServiceEnabled("ingest");
  const configured = saleshandyConfigured();

  // Heartbeat every pass (even when paused/idle) so the Services panel shows the
  // job is alive; `enabled` drives whether we actually import.
  await heartbeat("ingest", { enabled, saleshandy: configured });

  const idle = { imported: 0, skippedNoPhone: 0, errors: [] };
  if (!enabled) return { skipped: "disabled", ...idle };
  if (!configured) return { skipped: "not-configured", ...idle };

  const errors: string[] = [];
  let imported = 0;
  let skippedNoPhone = 0;

  try {
    const res = await importSaleshandyProspects({ uploadedBy });
    imported = res.imported;
    skippedNoPhone = res.skippedNoPhone;
    if (res.truncated) {
      console.warn("[ingest] saleshandy: page cap hit — more prospects remain");
    }
  } catch (e) {
    const msg = `saleshandy: ${(e as Error)?.message ?? e}`;
    errors.push(msg);
    console.error(`[ingest] ${msg}`);
  }

  if (imported > 0) {
    await heartbeat("ingest", {
      enabled,
      saleshandy: configured,
      lastImport: imported,
      lastImportAt: new Date().toISOString(),
    });
  }

  return { skipped: null, imported, skippedNoPhone, errors };
}
