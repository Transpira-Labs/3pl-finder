import { repCampaignOptions } from "@/lib/campaigns/service";
import { sessionRep } from "@/lib/queue/session-rep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The campaigns the signed-in rep may work, for the console's campaign picker.
 *
 * Derived from the session's rep identity, never from a request parameter, so
 * the list is exactly the rep's own assignments — the picker can't be used to
 * discover or select a campaign they're not on.
 */
export async function GET() {
  const s = await sessionRep();
  if (!s.ok) return s.res;

  return Response.json({ campaigns: await repCampaignOptions(s.rep.id) });
}
