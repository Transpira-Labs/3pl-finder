import { eq } from "drizzle-orm";
import { db } from "@/db";
import { smsMessages } from "@/db/schema";
import { readSignedWebhook } from "@/lib/telephony/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio message-status callback — set per-message via `statusCallback` on the
 * send, so nothing needs configuring on the number. Signature-verified like
 * every other Twilio-facing route.
 */

/** Statuses we persist; intermediates ("accepted", "sending") stay as queued. */
const TRACKED = new Set(["sent", "delivered", "undelivered", "failed"]);

export async function POST(request: Request) {
  const signed = await readSignedWebhook(request, "/api/sms/status");
  if (!signed.ok) return signed.res;

  const sid = signed.params.MessageSid ?? signed.params.SmsSid;
  const status = signed.params.MessageStatus ?? signed.params.SmsStatus;
  if (sid && status && TRACKED.has(status)) {
    const errorCode = Number(signed.params.ErrorCode);
    await db
      .update(smsMessages)
      .set({
        status: status as "sent" | "delivered" | "undelivered" | "failed",
        errorCode: Number.isFinite(errorCode) ? errorCode : null,
        statusUpdatedAt: new Date(),
      })
      .where(eq(smsMessages.twilioSid, sid));
  }

  return new Response(null, { status: 204 });
}
