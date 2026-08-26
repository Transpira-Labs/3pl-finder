import twilio from "twilio";

/**
 * Outbound SMS via Twilio Programmable Messaging.
 *
 * Texts always send from TWILIO_NUMBER — the same number /api/voice/outbound
 * uses as the caller ID — so a lead sees one identity across calls and texts.
 * There is deliberately no separate SMS-from configuration; moving to a
 * different number (e.g. a hosted personal number) moves both channels at
 * once by changing that one env var.
 */

/** The single shared sender: voice caller ID and SMS from-number. */
export function smsFromNumber(): string | null {
  return process.env.TWILIO_NUMBER || null;
}

export function smsConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    smsFromNumber()
  );
}

/**
 * Send one message. `statusCallbackUrl` is the absolute URL Twilio posts
 * delivery updates to — the caller derives it from the request (see
 * `publicUrl` in telephony/webhook.ts, which knows the Vercel-proxy rules).
 * Pass null when Twilio can't reach us (plain localhost dev): the row then
 * just keeps its create-time status.
 */
export async function sendSms(
  to: string,
  body: string,
  statusCallbackUrl: string | null,
): Promise<{ sid: string; status: string }> {
  const from = smsFromNumber();
  if (!smsConfigured() || !from) {
    throw new Error("SMS is not configured (TWILIO_* env vars missing).");
  }

  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );

  const message = await client.messages.create({
    to,
    from,
    body,
    ...(statusCallbackUrl ? { statusCallback: statusCallbackUrl } : {}),
  });

  return { sid: message.sid, status: message.status };
}
