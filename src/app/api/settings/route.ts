import { z } from "zod";
import { apiGuard } from "@/lib/auth/guards";
import {
  getConsoleSheetUrl,
  setConsoleSheetUrl,
  getInboundForwardNumbers,
  setInboundForwardNumbers,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Platform settings (admin). Read-only integration status plus the handful of
 * non-secret knobs. Secrets themselves stay in env and are never returned or
 * settable here; we only report whether each integration is wired.
 */
function connections(request: Request) {
  const origin = new URL(request.url).origin;
  return {
    telephony: {
      // Browser calling needs all four: the account, an API key (to mint the
      // rep's access token), the caller-ID number, and the TwiML App that points
      // Twilio at /api/voice/outbound when a rep's softphone dials.
      configured: !!(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_API_KEY_SID &&
        process.env.TWILIO_API_KEY_SECRET &&
        process.env.TWILIO_NUMBER &&
        process.env.TWILIO_TWIML_APP_SID
      ),
      number: process.env.TWILIO_NUMBER ?? null,
      twimlAppConfigured: !!process.env.TWILIO_TWIML_APP_SID,
      voiceUrl: `${origin}/api/voice/outbound`,
      // Inbound is wired on the NUMBER (Voice Request URL), not the TwiML App —
      // a separate place in the Twilio console from the outbound URL above.
      inboundVoiceUrl: `${origin}/api/voice/inbound`,
    },
    messaging: {
      // Follow-ups are email-only (Resend). Needs an API key + a verified From.
      email: !!(process.env.RESEND_API_KEY && process.env.FROM_EMAIL),
      fromEmail: process.env.FROM_EMAIL ?? null,
      replyTo: process.env.REPLY_TO_EMAIL ?? null,
    },
    leadSources: {
      saleshandy: !!process.env.SALESHANDY_API_KEY,
    },
    sms: {
      // Follow-up texts send from TWILIO_NUMBER — the same number used as the
      // voice caller ID, so calls and texts always present one identity.
      configured: !!(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_NUMBER
      ),
      from: process.env.TWILIO_NUMBER ?? null,
      drafting: !!process.env.ANTHROPIC_API_KEY,
      inboundUrl: `${origin}/api/sms/inbound`,
    },
    sheets: {
      configured: !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY),
      serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    },
  };
}

export async function GET(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;
  return Response.json({
    connections: connections(request),
    consoleSheetUrl: await getConsoleSheetUrl(),
    inboundForwardNumbers: await getInboundForwardNumbers(),
  });
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setConsoleSheetUrl"), sheetUrl: z.string() }),
  z.object({
    action: z.literal("setInboundForwardNumbers"),
    numbers: z.array(z.string()),
  }),
]);

export async function POST(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === "setConsoleSheetUrl") {
    await setConsoleSheetUrl(parsed.data.sheetUrl);
  } else if (parsed.data.action === "setInboundForwardNumbers") {
    await setInboundForwardNumbers(parsed.data.numbers);
  }

  return Response.json({
    ok: true,
    connections: connections(request),
    consoleSheetUrl: await getConsoleSheetUrl(),
    inboundForwardNumbers: await getInboundForwardNumbers(),
  });
}
