import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, callAttempts, leads } from "@/db/schema";
import { getLead, gateFor } from "@/lib/queue/service";
import { recordCalled } from "@/lib/pipeline/ledger";
import { checkInternalSuppression } from "@/lib/ingestion/dnc";
import {
  publicUrl,
  readSignedWebhook,
  twiml,
  xmlEscape,
} from "@/lib/telephony/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TwiML App voice webhook — what Twilio asks when a rep's softphone dials.
 *
 * The browser sends only `attemptId` (the row `/api/queue/call-start` created).
 * We resolve it to the lead's stored E.164 number here, server-side, so a rep
 * can never dial an arbitrary number through the account. The compliance gate is
 * re-checked one last time: a call that fails it is hung up before any number is
 * dialed, which is what "a failed check never leaves the queue" means now that
 * the queue is a person.
 *
 * Configure this URL as the TwiML App's Voice Request URL (see Settings →
 * Connections) and put the app's SID in TWILIO_TWIML_APP_SID.
 */

/** How long a call-start authorization stays valid before it must be re-taken. */
const AUTH_TTL_MS = 2 * 60 * 1000;

/**
 * Refuse the call. Hangs up the rep's own leg without dialing anyone — and
 * without speaking, since no synthesized audio may ever reach a lead. The reason
 * rides along as an XML comment so it shows up in Twilio's request inspector.
 */
const reject = (message: string) =>
  twiml(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><!-- ${xmlEscape(message)} --><Hangup/></Response>`,
  );

export async function POST(request: Request) {
  const signed = await readSignedWebhook(request, "/api/voice/outbound");
  if (!signed.ok) return signed.res;

  const attemptId = signed.params.attemptId;
  if (!attemptId) return reject("no attemptId");

  const [attempt] = await db
    .select()
    .from(callAttempts)
    .where(eq(callAttempts.id, attemptId))
    .limit(1);
  if (!attempt) return reject("unknown attempt");

  // Single-use and short-lived: a replayed attemptId can't re-dial the lead.
  if (attempt.endedAt) return reject("attempt already completed");
  if (Date.now() - attempt.startedAt.getTime() > AUTH_TTL_MS) {
    return reject("authorization expired");
  }

  // A test call (admin-authorized in /api/queue/test-call) has no lead behind
  // it, so there is no lead compliance gate to run. The number was normalized
  // and suppression-checked when the attempt was authorized; it is re-checked
  // here because "every dial passes a gate before a number is dialed" has to
  // hold on this path too, and a suppression entry can land in between.
  if (attempt.source === "test") {
    const suppressed = await checkInternalSuppression([attempt.phone]);
    if (suppressed.has(attempt.phone)) {
      await db
        .update(callAttempts)
        .set({ finalState: "DEAD", endedAt: new Date() })
        .where(eq(callAttempts.id, attempt.id));
      await db.insert(auditLog).values({
        event: "testcall.blocked",
        subjectPhone: attempt.phone,
        detail: { attemptId: attempt.id, reason: "suppressed at dial time" },
      });
      return reject("number is on the suppression list");
    }
    return dialTwiml(request, attempt.id, attempt.phone);
  }

  const lead = attempt.leadId ? await getLead(attempt.leadId) : null;
  if (!lead?.phone) return reject("lead has no number");

  // Last gate check before the number is dialed. This attempt's own row already
  // exists (call-start created it), so it must not count against cooldown/caps.
  const decision = await gateFor(lead, { excludeAttemptId: attempt.id });
  if (!decision.allowed) {
    await db
      .update(callAttempts)
      .set({ finalState: "DEAD", endedAt: new Date() })
      .where(eq(callAttempts.id, attempt.id));
    return reject(decision.reason ?? "blocked by compliance");
  }

  // Dial-release: the number is about to be dialed for real, so it counts as
  // contacted now. Written here rather than at call-start so a softphone that
  // never connected doesn't permanently burn the lead. Test calls skip this
  // entirely — they have no lead to burn.
  await recordCalled(lead.phone, lead.id);
  await db
    .update(leads)
    .set({ lastContacted: new Date() })
    .where(eq(leads.id, lead.id));

  return dialTwiml(request, attempt.id, lead.phone);
}

/**
 * The one place that emits a `<Dial>`. Both the lead path and the test path end
 * here, so there is a single spot where a number becomes a real call — and it
 * only ever reads a number that was resolved server-side.
 */
async function dialTwiml(
  request: Request,
  attemptId: string,
  phone: string,
): Promise<Response> {
  const callerId = process.env.TWILIO_NUMBER;
  if (!callerId) return reject("TWILIO_NUMBER is not set");

  const action = `${publicUrl(request, "/api/voice/status")}?attemptId=${encodeURIComponent(attemptId)}`;
  const record = process.env.TWILIO_RECORD_CALLS === "true";

  await db
    .update(callAttempts)
    .set({ finalState: "RINGING" })
    .where(eq(callAttempts.id, attemptId));

  // answerOnBridge keeps the rep on real ringback and stops the far leg from
  // being billed/answered until they actually pick up.
  return twiml(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response>` +
      `<Dial callerId="${xmlEscape(callerId)}" answerOnBridge="true" ` +
      `action="${xmlEscape(action)}" method="POST"` +
      (record ? ` record="record-from-answer-dual"` : "") +
      `>` +
      `<Number>${xmlEscape(phone)}</Number>` +
      `</Dial>` +
      `</Response>`,
  );
}
