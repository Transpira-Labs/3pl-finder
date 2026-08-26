import { z } from "zod";
import { serveNext } from "@/lib/queue/service";
import { sessionRep } from "@/lib/queue/session-rep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hand the signed-in rep their next callable lead, claimed to them so no other
 * rep is served the same prospect. Re-returns their existing claim on a reload.
 *
 * `campaignId` narrows the serve to one campaign the rep is already on. It's a
 * preference, not a grant: serveNext checks it against their assignments, so
 * naming someone else's campaign here yields nothing rather than their leads.
 */
const bodySchema = z.object({ campaignId: z.string().uuid().nullish() });

export async function POST(request: Request) {
  const s = await sessionRep();
  if (!s.ok) return s.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const result = await serveNext(
    s.rep.id,
    parsed.success ? (parsed.data.campaignId ?? null) : null,
  );
  return Response.json({ repId: s.rep.id, ...result });
}
