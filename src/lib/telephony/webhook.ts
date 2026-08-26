import twilio from "twilio";

/**
 * Shared helpers for the two Twilio voice webhooks (`/api/voice/outbound` and
 * `/api/voice/status`). These are the only Twilio-facing surfaces left — the
 * always-on telephony server is gone, because rep-initiated calling needs no
 * persistent process.
 */

/**
 * The public origin Twilio used to reach us — what the signature was computed
 * over. Rebuilt from the forwarded headers, because behind Vercel's proxy
 * `request.url` can carry an internal host while Twilio signed the public one.
 *
 * `PUBLIC_URL` is a **local-tunnel escape hatch only** and is deliberately
 * ignored when running on Vercel. It used to win unconditionally, which meant a
 * stale ngrok URL left in `.env` — and `.env` is uploaded by `vercel deploy` —
 * silently broke signature validation in production: Twilio signed the real
 * domain, we validated against the tunnel, every webhook 403'd, and calls hung up
 * before dialing. Hosted deployments always know their own origin, so there is
 * no legitimate reason to override it there.
 */
export function publicUrl(request: Request, path: string): string {
  const url = new URL(request.url);
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;

  const override = process.env.PUBLIC_URL?.replace(/\/$/, "");
  if (override) {
    if (!process.env.VERCEL) return `${override}${path}`;
    console.warn(
      `[webhook] ignoring PUBLIC_URL=${override} on Vercel — using ${proto}://${host}. ` +
        `Unset it in the project's environment variables.`,
    );
  }
  return `${proto}://${host}${path}`;
}

/**
 * Read a Twilio webhook body and verify it really came from Twilio.
 *
 * Twilio signs each request with the account auth token over the exact URL plus
 * the sorted POST params. Without this check anyone who learned the URL could
 * make us dial arbitrary numbers on your account. Set
 * `TWILIO_SKIP_WEBHOOK_VALIDATION=true` only for local tunnel debugging, where
 * the URL Twilio signed and the URL we see can legitimately differ.
 */
export async function readSignedWebhook(
  request: Request,
  path: string,
): Promise<
  { ok: true; params: Record<string, string> } | { ok: false; res: Response }
> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  if (process.env.TWILIO_SKIP_WEBHOOK_VALIDATION === "true") {
    return { ok: true, params };
  }

  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get("x-twilio-signature");
  if (!token || !signature) {
    return { ok: false, res: new Response("forbidden", { status: 403 }) };
  }
  // Twilio signs the URL it was given, query string included. The <Dial>
  // action URL carries ?attemptId=…, so validating against the bare path made
  // every /api/voice/status callback 403 — and a failed action callback makes
  // Twilio play "an application error has occurred" to the rep at the end of
  // the call. Sign over path + search, exactly as sent.
  const valid = twilio.validateRequest(
    token,
    signature,
    `${publicUrl(request, path)}${new URL(request.url).search}`,
    params,
  );
  if (!valid) {
    return { ok: false, res: new Response("invalid signature", { status: 403 }) };
  }
  return { ok: true, params };
}

/** TwiML response with the content type Twilio requires. */
export function twiml(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/** Escape text that goes inside a TwiML element or attribute. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
