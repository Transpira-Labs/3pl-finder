import { apiGuard } from "@/lib/auth/guards";
import { gateMessage } from "@/lib/messaging/gate";
import { emailConfigured } from "@/lib/messaging/email";

export const dynamic = "force-dynamic";

/**
 * GET /api/messaging/eligibility?leadId= — can this lead be emailed a follow-up
 * right now? Lets the send UI show the reason (no email, no consent, unsubscribed)
 * BEFORE the rep composes.
 *
 * Note: this runs the same gate as an actual send, which writes an audit row —
 * the eligibility check is itself a logged compliance decision.
 */
export async function GET(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const leadId = new URL(request.url).searchParams.get("leadId");
  if (!leadId) {
    return Response.json({ error: "leadId is required" }, { status: 400 });
  }

  if (!emailConfigured()) {
    return Response.json({
      allowed: false,
      configured: false,
      reason: "Email isn't configured on the server.",
      failedCheck: null,
    });
  }

  const gated = await gateMessage(leadId, "email");
  if (!gated) return Response.json({ error: "lead not found" }, { status: 404 });

  const { decision } = gated;
  return Response.json({
    allowed: decision.allowed,
    configured: true,
    toAddress: decision.toAddress,
    reason: decision.reason,
    failedCheck: decision.failedCheck,
  });
}
