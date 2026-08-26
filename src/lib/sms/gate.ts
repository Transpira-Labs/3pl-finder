import { db } from "@/db";
import { auditLog, leads } from "@/db/schema";
import { getDncScrubber, checkInternalSuppression } from "@/lib/ingestion/dnc";
import { isTextableBasisType } from "@/lib/ingestion/consent";
import type { ConsentBasisType } from "@/lib/ingestion/consent";
import { localHourInTimezone } from "@/lib/compliance/predial";

/**
 * Pre-send compliance gate for follow-up texts — the SMS sibling of
 * `checkDialable`. Runs when a draft is requested and again at the moment of
 * sending, and answers "may we text this number right now?".
 *
 * Deliberately lighter than the voice gate: no contact-ledger dedupe and no
 * frequency/cooldown checks, because a follow-up text is only ever offered
 * immediately after a legitimate call to the same lead — the call already
 * passed those. Every decision is logged immutably, same as pre-dial.
 */

/** Fixed texting window, lead-local. Mirrors the voice default (spec §6). */
const QUIET_HOURS_START = 8;
const QUIET_HOURS_END = 21;

export type SmsCheckName =
  | "eligible"
  | "consent"
  | "suppression"
  | "dnc"
  | "quiet_hours";

export type SmsGateDecision = {
  allowed: boolean;
  leadId: string;
  phone: string;
  failedCheck: SmsCheckName | null;
  reason: string | null;
  localTime: string | null;
};

type LeadRow = typeof leads.$inferSelect;

export async function checkTextable(
  lead: LeadRow,
  now: Date = new Date(),
): Promise<SmsGateDecision> {
  const base = {
    leadId: lead.id,
    phone: lead.phone ?? "",
    localTime: null as string | null,
  };

  const deny = async (
    failedCheck: SmsCheckName,
    reason: string,
    localTime: string | null = null,
  ): Promise<SmsGateDecision> => {
    const decision: SmsGateDecision = {
      allowed: false,
      ...base,
      localTime,
      failedCheck,
      reason,
    };
    await logDecision(decision);
    return decision;
  };

  // 1. There must be a number to text.
  if (!lead.phone) {
    return deny("eligible", "lead has no phone number");
  }
  const phone = lead.phone;

  // 2. Consent must be a textable basis.
  if (
    lead.consentStatus !== "has_basis" ||
    !isTextableBasisType(lead.consentBasisType as ConsentBasisType | null)
  ) {
    return deny("consent", "no valid consent basis for texting");
  }

  // 3+4. Internal suppression and DNC — an opt-out from any channel blocks SMS.
  const [suppressed, dncMap] = await Promise.all([
    checkInternalSuppression([phone]),
    getDncScrubber().scrub([phone]),
  ]);
  if (suppressed.has(phone)) {
    return deny("suppression", "on internal suppression / opt-out list");
  }
  if (dncMap.get(phone) === "listed") {
    return deny("dnc", "on DNC registry");
  }

  // 5. Quiet hours — same conservative posture as the voice gate: an unknown
  // timezone is a block, not a pass, because we can't prove it's legal.
  if (!lead.timezone) {
    return deny("quiet_hours", "unknown timezone; cannot verify local time");
  }
  const hour = localHourInTimezone(lead.timezone, now);
  if (hour == null) {
    return deny("quiet_hours", `invalid timezone: ${lead.timezone}`);
  }
  const localTime = `${hour}:00 ${lead.timezone}`;
  if (hour < QUIET_HOURS_START || hour >= QUIET_HOURS_END) {
    return deny(
      "quiet_hours",
      `local hour ${hour} outside ${QUIET_HOURS_START}:00–${QUIET_HOURS_END}:00`,
      localTime,
    );
  }

  const decision: SmsGateDecision = {
    allowed: true,
    ...base,
    localTime,
    failedCheck: null,
    reason: null,
  };
  await logDecision(decision);
  return decision;
}

async function logDecision(decision: SmsGateDecision) {
  await db.insert(auditLog).values({
    event: decision.allowed ? "sms.allowed" : "sms.blocked",
    subjectPhone: decision.phone,
    detail: {
      leadId: decision.leadId,
      failedCheck: decision.failedCheck,
      reason: decision.reason,
      localTime: decision.localTime,
    },
  });
}
