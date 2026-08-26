import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts } from "@/db/schema";

/**
 * Campaign metrics for the manual (rep-initiated) dialer.
 *
 * The predictive-era metrics — dials/min, time-to-human, hold time, abandonment
 * rate — described a machine dialing ahead of its reps. Nothing dials ahead any
 * more: a rep clicks Call and is on the line from the first ring, so the only
 * meaningful numbers are how many calls were placed, how many reached a person,
 * and how long they lasted. All computed from call_attempts.
 */
export async function campaignMetrics(campaignId: string, windowMinutes = 60) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const scope = and(
    eq(callAttempts.campaignId, campaignId),
    gte(callAttempts.startedAt, since),
  );

  const [totals] = await db
    .select({
      calls: count(),
      connected: sql<number>`count(*) filter (where ${callAttempts.reachedHuman})`,
      activeReps: sql<number>`count(distinct ${callAttempts.repId})`,
      // Wall-clock call duration; unfinished calls contribute 0 rather than NULL.
      totalTalkMs: sql<number>`coalesce(sum(
        extract(epoch from (${callAttempts.endedAt} - ${callAttempts.startedAt})) * 1000
      ) filter (where ${callAttempts.endedAt} is not null), 0)`,
      completed: sql<number>`count(*) filter (where ${callAttempts.endedAt} is not null)`,
    })
    .from(callAttempts)
    .where(scope);

  const calls = Number(totals?.calls ?? 0);
  const connected = Number(totals?.connected ?? 0);
  const completed = Number(totals?.completed ?? 0);
  const totalTalkMs = Number(totals?.totalTalkMs ?? 0);

  return {
    windowMinutes,
    calls,
    callsPerHour: (calls / windowMinutes) * 60,
    connected,
    connectRate: calls > 0 ? connected / calls : 0,
    avgCallMs: completed > 0 ? Math.round(totalTalkMs / completed) : 0,
    totalTalkMs,
    activeReps: Number(totals?.activeReps ?? 0),
  };
}

/** Disposition breakdown for the window — what the calls actually produced. */
export async function dispositionBreakdown(
  campaignId: string,
  windowMinutes = 60 * 24,
): Promise<Record<string, number>> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const rows = await db
    .select({
      disposition: callAttempts.disposition,
      n: count(),
    })
    .from(callAttempts)
    .where(
      and(
        eq(callAttempts.campaignId, campaignId),
        gte(callAttempts.startedAt, since),
      ),
    )
    .groupBy(callAttempts.disposition);

  const out: Record<string, number> = {};
  for (const r of rows) out[r.disposition ?? "none"] = Number(r.n);
  return out;
}

/** Recent call attempts for the dashboard. */
export async function recentCalls(campaignId: string, limit = 25) {
  return db
    .select()
    .from(callAttempts)
    .where(eq(callAttempts.campaignId, campaignId))
    .orderBy(sql`${callAttempts.startedAt} desc`)
    .limit(limit);
}
