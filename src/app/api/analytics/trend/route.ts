import { apiGuard } from "@/lib/auth/guards";
import { repIdForUser } from "@/lib/auth/rep";
import { daySeries } from "@/lib/analytics/stats";
import { currentDay, reportingTimezone, knownTags } from "@/lib/analytics/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The per-day metric series behind the trend strip, plus the tag-cohort table.
 * Pure SQL — no model involved, so this is free and safe to poll.
 */
export async function GET(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const url = new URL(request.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 180);
  const tz = await reportingTimezone();
  const end = url.searchParams.get("day") ?? (await currentDay());

  // Same scoping rule as /daily: reps see only their own series; managers see
  // everyone unless they ask for "just me". repId comes from the session.
  const scoped = guard.role === "rep" || url.searchParams.get("scope") === "me";
  const repId = scoped ? await repIdForUser(guard.userId) : null;

  const series = await daySeries(end, days, tz, repId);

  // Cohort table across the whole window: every tag versus the days without it.
  // Only days that actually had calls count — silent days would drag both sides
  // toward zero and make every tag look identical.
  const active = series.filter((d) => d.calls > 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const cohorts = (await knownTags()).map((tag) => {
    const withTag = active.filter((d) => d.tags.includes(tag));
    const without = active.filter((d) => !d.tags.includes(tag));
    return {
      tag,
      daysWith: withTag.length,
      daysWithout: without.length,
      // Cohorts compare the rate reps actually recorded, not the carrier flag.
      connectRateWith: mean(withTag.map((d) => d.reachedRate)),
      connectRateWithout: mean(without.map((d) => d.reachedRate)),
      avgCallsWith: mean(withTag.map((d) => d.calls)),
      avgCallsWithout: mean(without.map((d) => d.calls)),
    };
  });

  return Response.json({ timezone: tz, days, series, cohorts });
}
