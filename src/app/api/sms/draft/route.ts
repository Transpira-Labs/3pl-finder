import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, reps, campaigns } from "@/db/schema";
import { apiGuard } from "@/lib/auth/guards";
import { checkTextable } from "@/lib/sms/gate";
import {
  draftSms,
  anthropicConfigured,
  DraftUnavailable,
} from "@/lib/sms/drafter";
import { smsConfigured, smsFromNumber } from "@/lib/sms/sender";
import { dispositionLabel } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  leadId: z.string().uuid(),
  repId: z.string().uuid().nullable().optional(),
  disposition: z.string().nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
});

/**
 * Draft a follow-up text for a just-finished call. The compliance gate runs
 * *before* the model — a rep should never spend time editing a draft that
 * can't legally be sent. A blocked lead is a 200 with `blocked` set so the UI
 * can explain why, not an error.
 */
export async function POST(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  if (!smsConfigured() || !anthropicConfigured()) {
    return Response.json(
      {
        ok: false,
        error: !smsConfigured()
          ? "SMS isn't configured (TWILIO_NUMBER / Twilio credentials missing)."
          : "Drafting isn't configured (ANTHROPIC_API_KEY missing).",
      },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const b = parsed.data;

  const [lead] = await db.select().from(leads).where(eq(leads.id, b.leadId)).limit(1);
  if (!lead) {
    return Response.json({ ok: false, error: "lead not found" }, { status: 404 });
  }

  const gate = await checkTextable(lead);
  if (!gate.allowed) {
    return Response.json({
      ok: false,
      blocked: { check: gate.failedCheck, reason: gate.reason },
    });
  }

  const [rep] = b.repId
    ? await db.select({ name: reps.name }).from(reps).where(eq(reps.id, b.repId)).limit(1)
    : [];
  const [campaign] = lead.campaignId
    ? await db
        .select({ name: campaigns.name })
        .from(campaigns)
        .where(eq(campaigns.id, lead.campaignId))
        .limit(1)
    : [];

  try {
    const draft = await draftSms({
      leadName: lead.name,
      company: lead.company,
      leadNotes: lead.notes,
      disposition: b.disposition ? dispositionLabel(b.disposition) : null,
      repNote: b.note?.trim() || null,
      repName: rep?.name ?? null,
      campaignName: campaign?.name ?? null,
    });
    return Response.json({
      ok: true,
      draft: draft.body,
      to: lead.phone,
      from: smsFromNumber(),
    });
  } catch (e) {
    const message =
      e instanceof DraftUnavailable ? e.message : "Drafting failed — try again.";
    console.error("[sms] draft failed:", e);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
