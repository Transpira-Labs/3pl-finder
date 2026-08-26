import { assertCron } from "@/lib/cron-auth";
import { currentDay } from "@/lib/analytics/service";
import { addDays } from "@/lib/analytics/stats";
import { syncAnalyticsDay } from "@/lib/analytics/sheet-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Three days, each a 45-day stats scan plus a few Google round trips.
export const maxDuration = 120;

/** Days rewritten per run: today plus the two before it. */
const WINDOW = 3;

/**
 * Nightly refresh of the running `Analytics` tab.
 *
 * Calls already update their own day as they land, so this is the safety net,
 * and it earns its keep two ways: it closes gaps left by a per-call write that
 * failed (a shared sheet can be un-shared, Google can rate-limit), and it picks
 * up journal notes and tags, which are edited on the analytics page and never
 * trigger a call-driven resync.
 *
 * Sequential rather than parallel — three concurrent 45-day scans against a
 * remote database buy nothing and only bring the Sheets write quota closer.
 */
export async function GET(request: Request) {
  const denied = assertCron(request);
  if (denied) return denied;

  const started = Date.now();
  const today = await currentDay();
  const days = Array.from({ length: WINDOW }, (_, i) => addDays(today, -i));

  const results: { day: string; ok: boolean; error?: string }[] = [];
  for (const day of days) {
    try {
      await syncAnalyticsDay(day);
      results.push({ day, ok: true });
    } catch (e) {
      // One bad day must not skip the rest.
      console.error(`[cron/analytics-sheet] ${day} failed:`, e);
      results.push({ day, ok: false, error: (e as Error)?.message ?? "failed" });
    }
  }

  return Response.json({
    ok: results.every((r) => r.ok),
    ms: Date.now() - started,
    results,
  });
}
