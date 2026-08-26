import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, smsMessages, auditLog } from "@/db/schema";
import { apiGuard } from "@/lib/auth/guards";
import { checkTextable } from "@/lib/sms/gate";
import { sendSms, smsConfigured, smsFromNumber } from "@/lib/sms/sender";
import { publicUrl } from "@/lib/telephony/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  leadId: z.string().uuid(),
  callAttemptId: z.string().uuid().nullable().optional(),
  repId: z.string().uuid().nullable().optional(),
  body: z.string().min(1).max(1600),
  draftBody: z.string().max(1600),
});

/** Twilio's create-time statuses mapped onto our enum; anything else = queued. */
const CREATE_STATUSES = new Set(["queued", "sent", "delivered", "undelivered", "failed"]);

/**
 * Send the rep-approved follow-up text. The gate re-runs here — approval can
 * come minutes after the draft, and suppression lists or quiet hours may have
 * changed in between. Only an actual send writes an sms_messages row.
 */
export async function POST(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  if (!smsConfigured()) {
    return Response.json(
      { ok: false, error: "SMS isn't configured." },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const b = parsed.data;

  const [lead] = await db.select().from(leads).where(eq(leads.id, b.leadId)).limit(1);
  if (!lead?.phone) {
    return Response.json({ ok: false, error: "lead not found" }, { status: 404 });
  }

  const gate = await checkTextable(lead);
  if (!gate.allowed) {
    return Response.json({
      ok: false,
      blocked: { check: gate.failedCheck, reason: gate.reason },
    });
  }

  try {
    // Delivery receipts need a Twilio-reachable URL; plain localhost isn't one,
    // so local sends simply skip the callback and keep their create-time status.
    const callback = publicUrl(request, "/api/sms/status");
    const reachable = !/localhost|127\.0\.0\.1/.test(callback);
    const sent = await sendSms(lead.phone, b.body, reachable ? callback : null);

    const [row] = await db
      .insert(smsMessages)
      .values({
        leadId: lead.id,
        callAttemptId: b.callAttemptId ?? null,
        repId: b.repId ?? null,
        toPhone: lead.phone,
        fromPhone: smsFromNumber()!,
        draftBody: b.draftBody,
        body: b.body,
        status: (CREATE_STATUSES.has(sent.status) ? sent.status : "queued") as
          | "queued"
          | "sent"
          | "delivered"
          | "undelivered"
          | "failed",
        twilioSid: sent.sid,
      })
      .returning({ id: smsMessages.id });

    await db.insert(auditLog).values({
      event: "sms.sent",
      subjectPhone: lead.phone,
      detail: {
        leadId: lead.id,
        smsId: row.id,
        twilioSid: sent.sid,
        repId: b.repId ?? null,
        edited: b.body.trim() !== b.draftBody.trim(),
      },
    });

    return Response.json({ ok: true, id: row.id, twilioSid: sent.sid });
  } catch (e) {
    console.error("[sms] send failed:", e);
    return Response.json(
      { ok: false, error: "Twilio rejected the message — check the number and try again." },
      { status: 502 },
    );
  }
}
