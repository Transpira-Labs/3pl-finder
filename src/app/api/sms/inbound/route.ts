import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { recordOptOut } from "@/lib/compliance/predial";
import { readSignedWebhook, twiml } from "@/lib/telephony/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound SMS webhook — configure as the "A message comes in" URL on
 * TWILIO_NUMBER. v1 scope is deliberately minimal: honor opt-outs and keep an
 * audit trail; there is no inbox or threading UI.
 *
 * Twilio's carrier-level Advanced Opt-Out also intercepts STOP, but the
 * internal suppression write is ours — it's what the pre-dial and pre-send
 * gates consult, so an SMS opt-out blocks calls too.
 */

const OPT_OUT = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i;

export async function POST(request: Request) {
  const signed = await readSignedWebhook(request, "/api/sms/inbound");
  if (!signed.ok) return signed.res;

  const from = signed.params.From;
  const body = (signed.params.Body ?? "").trim();

  if (from && OPT_OUT.test(body)) {
    await recordOptOut(from, "SMS STOP reply");
  }

  if (from) {
    await db.insert(auditLog).values({
      event: "sms.inbound",
      subjectPhone: from,
      detail: { body: body.slice(0, 500), optOut: OPT_OUT.test(body) },
    });
  }

  // Empty TwiML: no auto-reply, and never synthesized content to a lead.
  return twiml(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
}
