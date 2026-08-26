import { eq } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts } from "@/db/schema";
import { setRepOnCall } from "@/lib/campaigns/service";
import { readSignedWebhook, twiml } from "@/lib/telephony/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `action` callback on the <Dial> in /api/voice/outbound — Twilio posts here the
 * moment the lead's leg ends, whichever side hung up. This is the authoritative
 * "the call is over" signal: it closes the call_attempts row and frees the rep,
 * replacing the predictive dialer's guesswork about when a rep was done.
 *
 * The rep's disposition arrives separately (console → /api/console/calls) and
 * updates the same row by id, so the two never race for the same fields.
 */

/** Twilio DialCallStatus → the call_attempts final state we record. */
const STATE_BY_DIAL_STATUS: Record<
  string,
  "BRIDGED" | "DEAD" | "ABANDONED"
> = {
  completed: "BRIDGED", // the lead picked up and the two legs were connected
  answered: "BRIDGED",
  busy: "DEAD",
  "no-answer": "DEAD",
  failed: "DEAD",
  canceled: "ABANDONED", // the rep hung up before the lead answered
};

export async function POST(request: Request) {
  const signed = await readSignedWebhook(request, "/api/voice/status");
  if (!signed.ok) return signed.res;

  const attemptId = new URL(request.url).searchParams.get("attemptId");
  const empty = twiml(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`,
  );
  if (!attemptId) return empty;

  const [attempt] = await db
    .select()
    .from(callAttempts)
    .where(eq(callAttempts.id, attemptId))
    .limit(1);
  if (!attempt) return empty;

  const dialStatus = signed.params.DialCallStatus ?? "";
  const finalState = STATE_BY_DIAL_STATUS[dialStatus] ?? "DEAD";
  const answered = finalState === "BRIDGED";
  const durationSec = Number(signed.params.DialCallDuration ?? 0);

  await db
    .update(callAttempts)
    .set({
      finalState,
      bridged: answered,
      // "Reached a human" here means the lead's line was answered. The rep's own
      // breakdown (right/wrong party) refines it when they disposition the call.
      reachedHuman: answered,
      abandoned: finalState === "ABANDONED",
      // The webhook fires as the leg ends, so "now" is the end. DialCallDuration
      // counts only from answer, so the gap between the two is the ring time.
      endedAt: new Date(),
      holdMs: Number.isFinite(durationSec)
        ? Math.max(0, Date.now() - attempt.startedAt.getTime() - durationSec * 1000)
        : null,
    })
    .where(eq(callAttempts.id, attempt.id));

  if (attempt.repId) await setRepOnCall(attempt.repId, false);

  // The rep's leg has nothing left to do once the dial ends.
  return empty;
}
