import { z } from "zod";
import { markAlreadyContacted, serveNext } from "@/lib/queue/service";
import { sessionRep } from "@/lib/queue/session-rep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  leadId: z.string().uuid(),
  // Keeps the rep in the campaign they picked when this serves the next card.
  campaignId: z.string().uuid().nullish(),
});

/**
 * "Already called" on the lead card: the rep recognises a number they worked
 * before this platform, so it should leave the queue for good rather than sink
 * to the back like a skip. Records the prior contact in the ledger and serves
 * the next lead.
 *
 * Like skip, the lead comes from the session's claim — the body only names which
 * lead the rep believes they're holding, and `markAlreadyContacted` refuses if
 * that claim isn't theirs.
 */
export async function POST(request: Request) {
  const s = await sessionRep();
  if (!s.ok) return s.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "leadId is required" }, { status: 400 });
  }

  const marked = await markAlreadyContacted(parsed.data.leadId, s.rep.id);
  if (!marked) {
    // Their claim lapsed and the lead moved on. Serving the next one is the
    // right recovery — failing outright would strand the card on a dead lead.
    const result = await serveNext(s.rep.id, parsed.data.campaignId ?? null);
    return Response.json({
      repId: s.rep.id,
      ...result,
      warning: "That lead was no longer yours — here's the next one.",
    });
  }

  const result = await serveNext(s.rep.id, parsed.data.campaignId ?? null);
  return Response.json({ repId: s.rep.id, ...result });
}
