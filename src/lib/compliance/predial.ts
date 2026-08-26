import { and, count, desc, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  leads,
  campaigns,
  callAttempts,
  auditLog,
  suppressionList,
  contactLedger,
  followUps,
} from "@/db/schema";
import { getDncScrubber, checkInternalSuppression } from "@/lib/ingestion/dnc";
import { isCallableBasisType } from "@/lib/ingestion/consent";
import type { ConsentBasisType } from "@/lib/ingestion/consent";

/**
 * Pre-dial compliance gate (spec §6).
 *
 * The counterpart to the import gate: it runs at dial time on a single lead and
 * answers "may we dial this number right now?". It re-checks things that can
 * change between import and call (DNC, consent, time of day) and adds per-attempt
 * limits (frequency caps, cooldown). Every decision is logged immutably.
 *
 * A dial that fails ANY check never leaves the queue (spec hard constraint).
 */

export type CheckName =
  | "eligible"
  | "already_contacted"
  | "consent"
  | "dnc"
  | "suppression"
  | "calling_hours"
  | "frequency_cap"
  | "cooldown";

export type PredialDecision = {
  allowed: boolean;
  leadId: string;
  phone: string;
  failedCheck: CheckName | null;
  reason: string | null;
  localTime: string | null;
};

type LeadRow = typeof leads.$inferSelect;
type CampaignRow = typeof campaigns.$inferSelect;

/** Compute the called-party local hour (0–23) from an IANA timezone. */
export function localHourInTimezone(timezone: string, at: Date): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = Number(fmt.format(at));
    return Number.isFinite(hour) ? hour % 24 : null;
  } catch {
    return null; // invalid timezone string
  }
}

export async function checkDialable(
  lead: LeadRow,
  campaign: CampaignRow,
  now: Date = new Date(),
  opts: {
    /**
     * The in-flight attempt authorizing this very dial. The /api/voice/outbound
     * re-check runs after call-start has already inserted the call's own
     * attempt row; counting it would make every dial block itself on cooldown.
     */
    excludeAttemptId?: string;
  } = {},
): Promise<PredialDecision> {
  const base = {
    leadId: lead.id,
    phone: lead.phone ?? "",
    localTime: null as string | null,
  };

  const deny = async (
    failedCheck: CheckName,
    reason: string,
    localTime: string | null = null,
  ): Promise<PredialDecision> => {
    const decision: PredialDecision = {
      allowed: false,
      ...base,
      localTime,
      failedCheck,
      reason,
    };
    await logDecision(decision, campaign.id);
    return decision;
  };

  // 1. Lead must be dial-eligible and have a phone.
  if (lead.validationStatus !== "eligible" || !lead.phone) {
    return deny("eligible", `lead is ${lead.validationStatus}, not eligible`);
  }
  const phone = lead.phone;

  // 2. Consent must still be a callable basis.
  if (
    lead.consentStatus !== "has_basis" ||
    !isCallableBasisType(lead.consentBasisType as ConsentBasisType | null)
  ) {
    return deny("consent", "no valid consent basis on record");
  }

  // 2.5. Already-contacted dedupe (spec §2). If the persistent contact ledger
  // shows this number has been called before, deny — UNLESS the lead has a
  // pending `call` follow-up now due, which is the sanctioned re-dial path. This
  // stops accidental duplicate dials across sessions while letting the follow-up
  // queue drive deliberate re-calls.
  const [ledgerRow] = await db
    .select({ callCount: contactLedger.callCount })
    .from(contactLedger)
    .where(eq(contactLedger.phone, phone))
    .limit(1);
  if (ledgerRow && ledgerRow.callCount > 0) {
    const [dueFollowUp] = await db
      .select({ id: followUps.id })
      .from(followUps)
      .where(
        and(
          eq(followUps.leadId, lead.id),
          eq(followUps.channel, "call"),
          eq(followUps.status, "pending"),
          lte(followUps.dueAt, now),
        ),
      )
      .limit(1);
    if (!dueFollowUp) {
      return deny("already_contacted", "already_called");
    }
  }

  // 3+4. DNC + internal suppression re-check (can change after import).
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

  // 5. Calling-hours gate — 8:00–21:00 called-party local by default. Unknown
  // timezone is treated conservatively as a block (we can't prove it's legal).
  if (!lead.timezone) {
    return deny("calling_hours", "unknown timezone; cannot verify local time");
  }
  const hour = localHourInTimezone(lead.timezone, now);
  const localTime = hour == null ? null : `${hour}:00 ${lead.timezone}`;
  if (hour == null) {
    return deny("calling_hours", `invalid timezone: ${lead.timezone}`);
  }
  if (hour < campaign.callingHoursStart || hour >= campaign.callingHoursEnd) {
    return deny(
      "calling_hours",
      `local hour ${hour} outside ${campaign.callingHoursStart}:00–${campaign.callingHoursEnd}:00`,
      localTime,
    );
  }

  // 6. Frequency cap — attempts in the last 24h must be under the campaign cap.
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [{ attempts } = { attempts: 0 }] = await db
    .select({ attempts: count() })
    .from(callAttempts)
    .where(
      and(
        eq(callAttempts.leadId, lead.id),
        gte(callAttempts.startedAt, dayAgo),
        ...(opts.excludeAttemptId
          ? [ne(callAttempts.id, opts.excludeAttemptId)]
          : []),
      ),
    );
  if (attempts >= campaign.perLeadDailyCap) {
    return deny(
      "frequency_cap",
      `${attempts} attempts in 24h ≥ cap of ${campaign.perLeadDailyCap}`,
      localTime,
    );
  }

  // 7. Cooldown — minimum minutes since the most recent attempt.
  const [last] = await db
    .select({ startedAt: callAttempts.startedAt })
    .from(callAttempts)
    .where(
      and(
        eq(callAttempts.leadId, lead.id),
        ...(opts.excludeAttemptId
          ? [ne(callAttempts.id, opts.excludeAttemptId)]
          : []),
      ),
    )
    .orderBy(desc(callAttempts.startedAt))
    .limit(1);
  if (last) {
    const minsSince = (now.getTime() - last.startedAt.getTime()) / 60000;
    if (minsSince < campaign.cooldownMinutes) {
      return deny(
        "cooldown",
        `only ${Math.floor(minsSince)}m since last attempt < ${campaign.cooldownMinutes}m cooldown`,
        localTime,
      );
    }
  }

  const decision: PredialDecision = {
    allowed: true,
    ...base,
    localTime,
    failedCheck: null,
    reason: null,
  };
  await logDecision(decision, campaign.id);
  return decision;
}

async function logDecision(decision: PredialDecision, campaignId: string) {
  await db.insert(auditLog).values({
    event: decision.allowed ? "predial.allowed" : "predial.blocked",
    subjectPhone: decision.phone,
    detail: {
      leadId: decision.leadId,
      campaignId,
      failedCheck: decision.failedCheck,
      reason: decision.reason,
      localTime: decision.localTime,
    },
  });
}

/**
 * Opt-out handling (spec §6): any no-contact request → permanent internal-DNC
 * insert + mark the lead. Idempotent.
 */
export async function recordOptOut(phone: string, note = "opt-out request") {
  await db
    .insert(suppressionList)
    .values({ phone, reason: note })
    .onConflictDoNothing();
  await db
    .update(leads)
    .set({ dncStatus: "listed", disposition: "opted_out" })
    .where(eq(leads.phone, phone));
  await db.insert(auditLog).values({
    event: "optout.recorded",
    subjectPhone: phone,
    detail: { note },
  });
}
