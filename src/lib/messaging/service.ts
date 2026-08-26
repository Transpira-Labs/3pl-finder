import { eq } from "drizzle-orm";
import { db } from "@/db";
import { messages, auditLog, leadActivities } from "@/db/schema";
import type { MessageChannel } from "@/lib/config";
import type { MessageCheckName } from "./gate";
import { gateMessage } from "./gate";
import { recordMessaged } from "@/lib/pipeline/ledger";
import { sendEmail, renderEmailHtml, renderEmailText } from "./email";
import { makeUnsubToken } from "./unsubscribe-token";

/**
 * Send-a-follow-up orchestrator (email). ONE entry point:
 *   1. run the compliance gate (checkMessageable) — deny ⇒ audited, no send;
 *   2. resolve the email SERVER-SIDE from the lead (the caller passes a leadId +
 *      text, never an address — same invariant as dialing);
 *   3. write a `messages` row (queued) BEFORE the provider call, so a crash still
 *      leaves a trace;
 *   4. hand off to Resend, then mark the row sent/failed with its providerId;
 *   5. audit + drop a timeline bubble on the lead so the send shows in history.
 */

export type SendMessageInput = {
  leadId: string;
  channel: MessageChannel;
  body: string;
  subject?: string | null;
  repId?: string | null;
  callAttemptId?: string | null;
  templateKey?: string | null;
};

export type SendMessageResult =
  | { ok: true; messageId: string; providerId: string | null; toAddress: string }
  | { ok: false; error: string; failedCheck?: MessageCheckName };

function publicOrigin(): string {
  return (process.env.PUBLIC_URL || "").replace(/\/$/, "");
}

/** Short one-line preview of a body for the timeline bubble. */
function preview(body: string, max = 80): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export async function sendMessage(
  input: SendMessageInput,
): Promise<SendMessageResult> {
  const gated = await gateMessage(input.leadId, input.channel);
  if (!gated) return { ok: false, error: "Lead not found." };

  const { lead, decision } = gated;
  if (!decision.allowed || !decision.toAddress) {
    return {
      ok: false,
      error: decision.reason ?? "This lead can't be messaged.",
      failedCheck: decision.failedCheck ?? undefined,
    };
  }
  const to = decision.toAddress;
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Message body is empty." };

  // Durable record BEFORE hand-off, so a mid-send crash is still visible.
  const [row] = await db
    .insert(messages)
    .values({
      leadId: lead.id,
      repId: input.repId ?? null,
      callAttemptId: input.callAttemptId ?? null,
      channel: input.channel,
      direction: "outbound",
      toAddress: to,
      subject: input.channel === "email" ? (input.subject ?? null) : null,
      body,
      templateKey: input.templateKey ?? null,
      status: "queued",
    })
    .returning();

  try {
    const unsubUrl = `${publicOrigin()}/api/messaging/unsubscribe?token=${makeUnsubToken(to)}`;
    const subject = input.subject?.trim() || "Following up";
    const { id: providerId } = await sendEmail({
      to,
      subject,
      html: renderEmailHtml(body, unsubUrl),
      text: renderEmailText(body, unsubUrl),
      headers: { "List-Unsubscribe": `<${unsubUrl}>` },
    });

    await db
      .update(messages)
      .set({ status: "sent", providerId, updatedAt: new Date() })
      .where(eq(messages.id, row.id));

    await db.insert(auditLog).values({
      event: "message.sent",
      subjectPhone: lead.phone ?? null,
      detail: {
        leadId: lead.id,
        messageId: row.id,
        channel: input.channel,
        providerId,
      },
    });

    await db.insert(leadActivities).values({
      leadId: lead.id,
      repId: input.repId ?? null,
      callAttemptId: input.callAttemptId ?? null,
      kind: "system",
      body: `Email sent → ${to}: ${preview(body)}`,
      meta: { messageId: row.id, channel: input.channel },
    });

    // Mark the universal contact ledger so this number reads as "reached out"
    // regardless of channel. Keyed by the lead's phone (its ledger identity).
    if (lead.phone) await recordMessaged(lead.phone, lead.id);

    return { ok: true, messageId: row.id, providerId, toAddress: to };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(messages)
      .set({ status: "failed", error: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(messages.id, row.id));
    await db.insert(auditLog).values({
      event: "message.failed",
      subjectPhone: lead.phone ?? null,
      detail: {
        leadId: lead.id,
        messageId: row.id,
        channel: input.channel,
        error: msg.slice(0, 300),
      },
    });
    return { ok: false, error: msg };
  }
}
