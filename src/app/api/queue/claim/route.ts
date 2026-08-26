import { z } from "zod";
import { claimSpecificLead } from "@/lib/queue/service";
import { sessionRep } from "@/lib/queue/session-rep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Claim one *named* lead for the signed-in rep — the pipeline's "call this
 * specific person" entry point. The console navigates here (via
 * /console?lead=<id>) when a rep picks a lead to follow up with, instead of
 * asking /api/queue/next for whoever is next.
 *
 * Selection only: this authorizes nothing. Dialing still goes through
 * /api/queue/call-start, which re-checks the claim, the rep's campaigns, and
 * the compliance gate before any attempt is created.
 */
const bodySchema = z.object({ leadId: z.string().uuid() });

export async function POST(request: Request) {
  const s = await sessionRep();
  if (!s.ok) return s.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "leadId is required" }, { status: 400 });
  }

  const result = await claimSpecificLead(parsed.data.leadId, s.rep.id);
  if (!result.ok) {
    return Response.json(
      { error: result.error, ...(result.reason ? { reason: result.reason } : {}) },
      { status: result.status },
    );
  }
  return Response.json({ lead: result.lead });
}
