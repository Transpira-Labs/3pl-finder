import { z } from "zod";
import { db } from "@/db";
import { auditLog, callAttempts } from "@/db/schema";
import { apiGuard } from "@/lib/auth/guards";
import { sessionRep } from "@/lib/queue/session-rep";
import { normalizePhone } from "@/lib/ingestion/phone";
import { checkInternalSuppression, getDncScrubber } from "@/lib/ingestion/dnc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ phone: z.string().min(1).max(32) });

/**
 * Authorize one *test* call to an operator-supplied number — the "does the
 * softphone actually work" path. Admin only.
 *
 * This is the single deliberate exception to "the browser never supplies a
 * phone number", so it is worth being precise about what is and isn't relaxed:
 *
 *  - The browser still never hands a number to `device.connect`. It posts the
 *    number *here*, gets back an `attemptId`, and dials that. `/api/voice/
 *    outbound` still resolves the id to a server-stored number, so the TwiML
 *    webhook remains the only thing that decides what gets dialed.
 *  - Admin only (`apiGuard(["admin"])`). A rep session cannot reach this route,
 *    so the property that matters — a rep cannot dial arbitrary numbers on the
 *    Twilio account — is unchanged.
 *  - The number is normalized to E.164 and checked against the internal
 *    suppression list and the DNC seam before an attempt row exists. Someone
 *    who opted out is never dialed, test or not.
 *  - Every authorization writes to `audit_log`, allowed or denied, so a manually
 *    dialed number is as traceable as a lead dial.
 *
 * Test attempts carry `source: "test"` and no `leadId`, which is what keeps them
 * out of Call Analytics and off the contact ledger.
 */
export async function POST(request: Request) {
  // Admin gate first — before anything reads the body.
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  // Reuse the session's own rep identity so the call shows up on the right
  // softphone and the right stopwatch.
  const s = await sessionRep();
  if (!s.ok) return s.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "A phone number is required." }, { status: 400 });
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone.ok) {
    return Response.json(
      { error: `That number isn't dialable — ${phone.reason}.` },
      { status: 400 },
    );
  }

  const deny = async (reason: string) => {
    await db.insert(auditLog).values({
      event: "testcall.blocked",
      subjectPhone: phone.e164,
      detail: { reason, userId: guard.userId, repId: s.rep.id },
    });
    return Response.json({ error: reason }, { status: 403 });
  };

  // An opt-out is an opt-out. A test call is still a real call to a real
  // handset, so the suppression list and the DNC seam both apply.
  const suppressed = await checkInternalSuppression([phone.e164]);
  if (suppressed.has(phone.e164)) {
    return deny("That number is on the internal suppression / opt-out list.");
  }
  const dnc = await getDncScrubber().scrub([phone.e164]);
  if (dnc.get(phone.e164) === "listed") {
    return deny("That number is on the Do Not Call registry.");
  }

  const [attempt] = await db
    .insert(callAttempts)
    .values({
      leadId: null,
      campaignId: null,
      phone: phone.e164,
      repId: s.rep.id,
      // Excluded from Call Analytics and never written to the contact ledger.
      source: "test",
      finalState: "DIALING",
    })
    .returning();

  await db.insert(auditLog).values({
    event: "testcall.allowed",
    subjectPhone: phone.e164,
    detail: { attemptId: attempt.id, userId: guard.userId, repId: s.rep.id },
  });

  return Response.json({ attemptId: attempt.id, phone: phone.e164 });
}
