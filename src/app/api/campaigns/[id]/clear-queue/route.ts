import { clearCampaignQueue, getCampaign } from "@/lib/campaigns/service";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/**
 * Empty a campaign's unworked queue so a fresh list can be assigned into it.
 *
 * Leads that were actually called are kept, as are any under a live claim. The
 * contact ledger keeps every number that was dialed and releases the ones that
 * were only ever imported — see `clearCampaignQueue` for why that split is the
 * point of the operation.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return Response.json({ error: "not found" }, { status: 404 });

  try {
    const result = await clearCampaignQueue(id);
    return Response.json({ ok: true, name: campaign.name, ...result });
  } catch (e) {
    console.error("[campaigns] clear queue failed:", e);
    return Response.json(
      { error: (e as Error)?.message ?? "Could not clear the queue." },
      { status: 500 },
    );
  }
}
