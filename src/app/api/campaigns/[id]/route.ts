import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts } from "@/db/schema";
import {
  getCampaign,
  listCampaignReps,
  listCampaignLeads,
  deleteCampaign,
} from "@/lib/campaigns/service";
import {
  campaignMetrics,
  dispositionBreakdown,
  recentCalls,
} from "@/lib/observability/metrics";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/** Bundled dashboard snapshot for one campaign. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return Response.json({ error: "not found" }, { status: 404 });

  const [reps, metrics, calls, dispositions, campaignLeads, attempts] =
    await Promise.all([
      listCampaignReps(id),
      campaignMetrics(id, 60),
      recentCalls(id, 20),
      dispositionBreakdown(id),
      listCampaignLeads(id),
      db
        .select({
          leadId: callAttempts.leadId,
          finalState: callAttempts.finalState,
          reachedHuman: callAttempts.reachedHuman,
          disposition: callAttempts.disposition,
          startedAt: callAttempts.startedAt,
        })
        .from(callAttempts)
        .where(eq(callAttempts.campaignId, id))
        .orderBy(desc(callAttempts.startedAt)),
    ]);

  // "Idle" reps: signed in and available, but not currently on a call. No longer
  // feeds a governor — it's just a live view of who could pick up the next lead.
  const idleReps = reps.filter(
    (r) => r.presence === "available" && !r.onCall,
  ).length;

  // Latest attempt per lead → the lead's current call status.
  const latestByLead = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) {
    if (a.leadId && !latestByLead.has(a.leadId)) latestByLead.set(a.leadId, a);
  }

  const leadList = campaignLeads.map((l) => {
    const att = latestByLead.get(l.id);
    return {
      id: l.id,
      phone: l.phone,
      name: l.name,
      company: l.company,
      timezone: l.timezone,
      attempted: !!att,
      outcome: att?.finalState ?? null,
      reachedHuman: att?.reachedHuman ?? false,
      disposition: att?.disposition ?? l.disposition,
      attemptedAt: att?.startedAt ? att.startedAt.toISOString() : null,
    };
  });

  const called = leadList.filter((l) => l.attempted).length;

  return Response.json({
    campaign,
    reps,
    idleReps,
    queueDepth: campaignLeads.length,
    calledCount: called,
    remainingCount: campaignLeads.length - called,
    metrics,
    dispositions,
    calls,
    leads: leadList,
  });
}

/**
 * Delete a campaign. Its leads are unassigned rather than deleted (they outlive
 * any one campaign), rep assignments are dropped, and call history is left
 * intact — see `deleteCampaign` for why each referrer is treated that way.
 *
 * Returns what was detached so the UI can report it instead of guessing.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return Response.json({ error: "not found" }, { status: 404 });

  try {
    const result = await deleteCampaign(id);
    return Response.json({ ok: true, name: campaign.name, ...result });
  } catch (e) {
    console.error("[campaigns] delete failed:", e);
    return Response.json(
      { error: (e as Error)?.message ?? "Could not delete the campaign." },
      { status: 500 },
    );
  }
}
