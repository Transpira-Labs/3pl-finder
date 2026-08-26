import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, callAttempts, leads } from "@/db/schema";
import { getInboundForwardNumbers } from "@/lib/settings";
import { readSignedWebhook, twiml, xmlEscape } from "@/lib/telephony/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound voice webhook — a lead calling the Twilio number back, typically
 * returning a voicemail.
 *
 * Forwards to the personal cells configured in Settings → Connections, rung
 * simultaneously; the first to answer takes the call. Cells rather than the
 * browser softphone on purpose: callbacks land hours after the voicemail, long
 * after any console tab is closed, so ringing a client that isn't there would
 * drop exactly the calls this exists to catch.
 *
 * Configure this URL as the number's **Voice Request URL** (a number-level
 * setting, separate from the TwiML App that handles outbound).
 *
 * Two things here deliberately differ from the outbound path:
 *
 *  - **No compliance gate.** `checkDialable` answers "may we dial this number
 *    now" — calling hours, cooldown, caps, DNC. None of it governs a call the
 *    lead chose to place. A lead on the DNC list may still ring back, and
 *    answering them is not a dial. Running the gate here would reject callbacks
 *    for being outside the hours *we* may call.
 *  - **We still don't speak.** Same invariant as everywhere else: no synthesized
 *    audio ever reaches a lead, so there is no greeting and no menu. The call
 *    either bridges to a human or hangs up.
 */

/** Hang up without speaking. Reason rides as a comment for Twilio's inspector. */
const hangup = (message: string) =>
  twiml(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><!-- ${xmlEscape(message)} --><Hangup/></Response>`,
  );

export async function POST(request: Request) {
  const signed = await readSignedWebhook(request, "/api/voice/inbound");
  if (!signed.ok) return signed.res;

  const from = (signed.params.From ?? "").trim();
  const to = (signed.params.To ?? "").trim();
  const callSid = signed.params.CallSid ?? null;

  const forwardTo = await getInboundForwardNumbers();

  // Attach the call to a lead when the caller is one we know. Matched on the
  // stored E.164, which is what Twilio sends — no normalizing needed, and a
  // miss is fine: strangers and withheld numbers still get forwarded.
  const [lead] = from
    ? await db.select().from(leads).where(eq(leads.phone, from)).limit(1)
    : [];

  // Log before dialing, so a callback that nobody picks up still leaves a trace.
  // `source: "inbound"` keeps these out of the outbound dialer's figures, which
  // count calls we placed.
  await db.insert(callAttempts).values({
    leadId: lead?.id ?? null,
    campaignId: lead?.campaignId ?? null,
    phone: from || "unknown",
    source: "inbound",
    startedAt: new Date(),
    timeline: [{ state: "inbound_received", at: new Date().toISOString() }],
  });

  await db.insert(auditLog).values({
    event: forwardTo.length ? "inbound.forwarded" : "inbound.rejected",
    subjectPhone: from || null,
    detail: {
      to,
      callSid,
      leadId: lead?.id ?? null,
      forwardTo,
      reason: forwardTo.length ? null : "no forwarding numbers configured",
    },
  });

  if (!forwardTo.length) {
    return hangup("no inbound forwarding numbers configured");
  }

  // callerId is our own Twilio number, never the lead's. Twilio requires a
  // number the account owns or has verified, and it keeps the single-sender
  // rule intact — every leg the outside world sees is TWILIO_NUMBER. The
  // trade-off is that the cell shows the work number rather than the lead, so
  // who called is answered by the call_attempts row above, not the screen.
  const callerId = to || process.env.TWILIO_NUMBER || "";
  const numbers = forwardTo
    .map((n) => `<Number>${xmlEscape(n)}</Number>`)
    .join("");

  // timeout 25s: long enough for a cell to ring through, short enough to fall to
  // the carrier's voicemail rather than leaving the lead hanging. No `action` —
  // when the dial ends, so does the call; /api/voice/status still gets the
  // completion callback for the leg.
  return twiml(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Dial timeout="25" callerId="${xmlEscape(callerId)}">${numbers}</Dial></Response>`,
  );
}
