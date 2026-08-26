import { verifyUnsubToken } from "@/lib/messaging/unsubscribe-token";
import { recordEmailOptOut } from "@/lib/messaging/gate";

export const dynamic = "force-dynamic";

function page(title: string, message: string, ok: boolean): Response {
  const color = ok ? "#059669" : "#dc2626";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f9fafb;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="max-width:420px;padding:32px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;text-align:center">
<h1 style="font-size:18px;margin:0 0 8px;color:${color}">${title}</h1>
<p style="font-size:14px;color:#374151;margin:0">${message}</p>
</div></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * GET /api/messaging/unsubscribe?token=… — CAN-SPAM unsubscribe link target from
 * the email footer. The token is a signed email address (no login, no stored
 * token). Adds the address to the email suppression list, after which the message
 * gate blocks every future email to it.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const email = verifyUnsubToken(token);
  if (!email) {
    return page(
      "Invalid link",
      "This unsubscribe link is invalid or has expired.",
      false,
    );
  }
  await recordEmailOptOut(email, "unsubscribe link");
  return page(
    "You're unsubscribed",
    `${email} will no longer receive follow-up emails from us.`,
    true,
  );
}
