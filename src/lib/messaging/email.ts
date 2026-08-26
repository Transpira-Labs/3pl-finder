/**
 * Email transport (Resend REST). No SDK — a single fetch, same posture as the
 * Google Sheets integration. Requires a verified sending domain in Resend plus
 * `RESEND_API_KEY` and `FROM_EMAIL`. Every marketing-style email gets a CAN-SPAM
 * unsubscribe link + physical-address footer, so senders go through renderEmailHtml.
 */

export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.FROM_EMAIL);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Physical postal address for the CAN-SPAM footer (a legal requirement). */
function mailingAddress(): string {
  return process.env.MAILING_ADDRESS || "Our mailing address is on file.";
}

/** Turn a plain-text body into simple HTML + the compliant footer. */
export function renderEmailHtml(bodyText: string, unsubscribeUrl: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">
${paragraphs}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<p style="font-size:12px;color:#6b7280">
${escapeHtml(mailingAddress())}<br>
If you'd prefer not to receive these emails, <a href="${unsubscribeUrl}" style="color:#6b7280">unsubscribe here</a>.
</p>
</div>`;
}

/** Plain-text alternative, including the unsubscribe URL. */
export function renderEmailText(bodyText: string, unsubscribeUrl: string): string {
  return `${bodyText}\n\n—\n${mailingAddress()}\nUnsubscribe: ${unsubscribeUrl}`;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL;
  if (!key || !from) {
    throw new Error(
      "Email isn't configured. Set RESEND_API_KEY and FROM_EMAIL (with a verified Resend domain).",
    );
  }
  // Send from the verified domain but route replies to a monitored inbox.
  const replyTo = process.env.REPLY_TO_EMAIL;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: data.id ?? "" };
}
