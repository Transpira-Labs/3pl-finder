import { z } from "zod";
import { db } from "@/db";
import { callAttempts } from "@/db/schema";
import { gateFor, getLead } from "@/lib/queue/service";
import { sessionRep } from "@/lib/queue/session-rep";
import { setRepOnCall, repCampaignIds } from "@/lib/campaigns/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ leadId: z.string().uuid() });

/**
 * Authorize one call and open its record. The browser calls this *before* it
 * connects the softphone, and gets back only an `attemptId` — never a phone
 * number. `/api/voice/outbound` resolves that id back to the lead's stored E.164
 * number when Twilio asks what to dial.
 *
 * That indirection is the security boundary: a rep's browser cannot cause an
 * arbitrary number to be dialed on the account, because it never supplies one.
 *
 * The compliance gate runs here, at the moment of dialing — being served a lead
 * a few minutes ago is not standing permission to call it (calling hours close,
 * cooldowns start, suppression lists change). A denial writes to `audit_log` via
 * checkDialable and the call never leaves.
 */
export async function POST(request: Request) {
  const s = await sessionRep();
  if (!s.ok) return s.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "leadId is required" }, { status: 400 });
  }

  const lead = await getLead(parsed.data.leadId);
  if (!lead) return Response.json({ error: "lead not found" }, { status: 404 });

  // The rep must hold the claim — otherwise two reps could dial one prospect.
  if (lead.claimedByRepId !== s.rep.id) {
    return Response.json(
      { error: "This lead is no longer yours — skip to the next one." },
      { status: 409 },
    );
  }

  // …and the lead must belong to a campaign this rep is on. Holding a claim is
  // not enough: an admin can remove someone from a campaign while a lead is
  // still on their screen, and a stale card must not stay dialable. Re-checked
  // here rather than trusted from serve time, because this is the request that
  // authorizes a real call.
  const repCampaigns = await repCampaignIds(s.rep.id);
  if (!lead.campaignId || !repCampaigns.includes(lead.campaignId)) {
    return Response.json(
      { error: "This lead isn't on one of your campaigns — skip to the next one." },
      { status: 403 },
    );
  }

  const decision = await gateFor(lead);
  if (!decision.allowed) {
    return Response.json(
      {
        error: "blocked by compliance",
        failedCheck: decision.failedCheck,
        reason: decision.reason,
      },
      { status: 403 },
    );
  }

  const [attempt] = await db
    .insert(callAttempts)
    .values({
      leadId: lead.id,
      campaignId: lead.campaignId,
      phone: lead.phone!,
      repId: s.rep.id,
      source: "manual",
      finalState: "DIALING",
    })
    .returning();

  // NOTE: the contact ledger is deliberately NOT written here. This row only
  // authorizes a call; the number counts as called at dial-release, in
  // /api/voice/outbound. Writing it here would burn the lead (the gate denies
  // `already_contacted` forever after) even if the softphone failed to connect.
  await setRepOnCall(s.rep.id, true);

  return Response.json({
    attemptId: attempt.id,
    leadId: lead.id,
    // Returned for display only — the dial itself uses the server-side number.
    phone: lead.phone,
  });
}
