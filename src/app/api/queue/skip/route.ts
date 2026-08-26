import { z } from "zod";
import { serveNext, skipLead } from "@/lib/queue/service";
import { sessionRep } from "@/lib/queue/session-rep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  leadId: z.string().uuid(),
  // Keeps the rep in the campaign they picked when the skip serves the next card.
  campaignId: z.string().uuid().nullish(),
});

/**
 * Skip the lead on screen: release the claim (the `last_served_at` stamp taken
 * when it was served sinks it to the back of the queue) and serve the next one.
 * Only the rep holding the claim can release it.
 */
export async function POST(request: Request) {
  const s = await sessionRep();
  if (!s.ok) return s.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "leadId is required" }, { status: 400 });
  }

  await skipLead(parsed.data.leadId, s.rep.id);
  const result = await serveNext(s.rep.id, parsed.data.campaignId ?? null);
  return Response.json({ repId: s.rep.id, ...result });
}
