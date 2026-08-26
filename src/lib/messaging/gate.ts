import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, auditLog, emailSuppression } from "@/db/schema";
import type { ConsentBasisType } from "@/lib/ingestion/consent";
import { isCallableBasisType } from "@/lib/ingestion/consent";
import type { MessageChannel } from "@/lib/config";

/**
 * Email message gate — the follow-up counterpart to checkDialable.
 *
 * Reuses the universal core of the dial gate (a recorded, recognized consent
 * basis) and adds the email-specific rule: the address must not be on the CAN-SPAM
 * unsubscribe list. Like the dial gate, every decision is written to audit_log. As
 * consent.ts warns, this encodes well-formedness, not legality — counsel owns
 * whether a given lead is truly messageable.
 */

export type MessageCheckName =
  | "eligible"
  | "no_contact_point"
  | "consent"
  | "suppression";

export type MessageDecision = {
  allowed: boolean;
  leadId: string;
  channel: MessageChannel;
  /** Resolved contact point (the email), server-side. */
  toAddress: string | null;
  failedCheck: MessageCheckName | null;
  reason: string | null;
};

type LeadRow = typeof leads.$inferSelect;

/** True if this email is on the CAN-SPAM unsubscribe list. Case-insensitive. */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: emailSuppression.id })
    .from(emailSuppression)
    .where(eq(emailSuppression.email, email.trim().toLowerCase()))
    .limit(1);
  return !!row;
}

/**
 * Record an email unsubscribe (CAN-SPAM). Idempotent: insert into the email
 * suppression list + audit. Does not touch the lead's phone dncStatus.
 */
export async function recordEmailOptOut(email: string, note = "unsubscribe") {
  const addr = email.trim().toLowerCase();
  await db
    .insert(emailSuppression)
    .values({ email: addr, reason: note })
    .onConflictDoNothing();
  await db.insert(auditLog).values({
    event: "email_optout.recorded",
    detail: { email: addr, note },
  });
}

export async function checkMessageable(
  lead: LeadRow,
  channel: MessageChannel = "email",
  _now: Date = new Date(),
): Promise<MessageDecision> {
  const base = { leadId: lead.id, channel, toAddress: null as string | null };

  const deny = async (
    failedCheck: MessageCheckName,
    reason: string,
    toAddress: string | null = null,
  ): Promise<MessageDecision> => {
    const decision: MessageDecision = {
      allowed: false,
      ...base,
      toAddress,
      failedCheck,
      reason,
    };
    await logDecision(decision, lead);
    return decision;
  };

  // 1. Lead must be a real, contactable lead (not invalid/quarantined).
  if (lead.validationStatus !== "eligible") {
    return deny("eligible", `lead is ${lead.validationStatus}, not eligible`);
  }

  // 2. Needs an email on record.
  const toAddress = lead.email;
  if (!toAddress) {
    return deny("no_contact_point", "no email on record");
  }

  // 3. Consent — a recorded, recognized basis.
  const basis = lead.consentBasisType as ConsentBasisType | null;
  if (lead.consentStatus !== "has_basis" || !isCallableBasisType(basis)) {
    return deny("consent", "no valid consent basis on record", toAddress);
  }

  // 4. Email must not have unsubscribed (CAN-SPAM).
  if (await isEmailSuppressed(toAddress)) {
    return deny("suppression", "email has unsubscribed", toAddress);
  }

  const decision: MessageDecision = {
    allowed: true,
    ...base,
    toAddress,
    failedCheck: null,
    reason: null,
  };
  await logDecision(decision, lead);
  return decision;
}

async function logDecision(decision: MessageDecision, lead: LeadRow) {
  await db.insert(auditLog).values({
    event: decision.allowed ? "message.allowed" : "message.blocked",
    subjectPhone: lead.phone ?? null,
    detail: {
      leadId: decision.leadId,
      channel: decision.channel,
      failedCheck: decision.failedCheck,
      reason: decision.reason,
    },
  });
}

/** Load a lead and run the gate. Convenience wrapper (mirrors queue's gateFor). */
export async function gateMessage(
  leadId: string,
  channel: MessageChannel = "email",
  now: Date = new Date(),
): Promise<{ lead: LeadRow; decision: MessageDecision } | null> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return null;
  const decision = await checkMessageable(lead, channel, now);
  return { lead, decision };
}
