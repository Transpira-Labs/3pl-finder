import { runIngestPass } from "@/lib/workers/ingest-pass";
import { assertCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A pass reads and writes every linked sheet through the Google API; give it room.
export const maxDuration = 300;

/**
 * Scheduled lead-sheet import — the hosted replacement for `npm run ingest`.
 *
 * Vercel invokes this on the schedule in vercel.json. It runs the exact same
 * pass the local worker loops over, and the pass is idempotent (the sheet's
 * Result column plus the contact ledger both prevent re-importing a row), so a
 * retry or an overlapping run can't double-import.
 */
export async function GET(request: Request) {
  const denied = assertCron(request);
  if (denied) return denied;

  const started = Date.now();
  try {
    const result = await runIngestPass("vercel-cron");
    return Response.json({ ok: true, ms: Date.now() - started, ...result });
  } catch (e) {
    console.error("[cron/ingest] pass failed:", e);
    return Response.json(
      { ok: false, error: (e as Error)?.message ?? "pass failed" },
      { status: 500 },
    );
  }
}
