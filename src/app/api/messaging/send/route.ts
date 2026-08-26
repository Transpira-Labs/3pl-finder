import { z } from "zod";
import { sessionRep } from "@/lib/queue/session-rep";
import { sendMessage } from "@/lib/messaging/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  leadId: z.string().uuid(),
  channel: z.literal("email"),
  body: z.string().min(1),
  subject: z.string().optional(),
  templateKey: z.string().optional(),
  callAttemptId: z.string().uuid().optional(),
});

/**
 * POST /api/messaging/send — send an SMS or email follow-up to a lead.
 *
 * The rep identity comes from the session (never the body), and the destination
 * address is resolved server-side inside sendMessage from the lead — the browser
 * supplies only leadId + text, mirroring the "browser never supplies the number"
 * invariant of dialing. The compliance gate runs inside sendMessage.
 */
export async function POST(request: Request) {
  const rep = await sessionRep();
  if (!rep.ok) return rep.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await sendMessage({
    leadId: parsed.data.leadId,
    channel: parsed.data.channel,
    body: parsed.data.body,
    subject: parsed.data.subject ?? null,
    templateKey: parsed.data.templateKey ?? null,
    callAttemptId: parsed.data.callAttemptId ?? null,
    repId: rep.rep.id,
  });

  if (!result.ok) {
    // 422: the request was well-formed but the lead can't be messaged (gate) or
    // the provider rejected it — the UI shows `error` inline.
    return Response.json(
      { error: result.error, failedCheck: result.failedCheck ?? null },
      { status: 422 },
    );
  }
  return Response.json(result);
}
