import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, leadActivities, leads } from "@/db/schema";
import { localHourInTimezone } from "@/lib/compliance/predial";
import { MAX_CALLBACK_ATTEMPTS } from "@/lib/config";

/**
 * Callback retry scheduling.
 *
 * A lead that went to voicemail or didn't pick up comes back at a *different time
 * of day* — the point being that someone who never answers at 9am might at 6pm.
 * The campaign's own calling window is split into three slots, and each retry
 * rotates one slot forward, on a later day (which is also the cooldown before the
 * lead is dialable again). The console route moves such leads into the rolling
 * Callbacks campaign first, so these retries are scheduled against that campaign's
 * window.
 *
 * Two constraints from the compliance gate (`src/lib/compliance/predial.ts`)
 * shape this:
 *  - A lead that has been called is denied *unless* a `call` follow-up is due, so
 *    the retry must be scheduled as a follow-up or the lead is gone forever.
 *  - `cooldownMinutes` (default 60) and `perLeadDailyCap` (default 3, rolling
 *    24h) both apply. Scheduling a day out clears both without special-casing.
 */

export type Slot = "morning" | "midday" | "evening";

export const SLOTS: Slot[] = ["morning", "midday", "evening"];

type CampaignRow = typeof campaigns.$inferSelect;
type HourWindow = [number, number]; // [startInclusive, endExclusive)

/**
 * Split the campaign's calling window into three equal slots. Derived rather than
 * hardcoded so a campaign with, say, 10:00–16:00 hours still gets three usable
 * slots instead of two that fall outside its window and never pass the gate.
 */
export function slotBounds(campaign: CampaignRow): Record<Slot, HourWindow> {
  const start = campaign.callingHoursStart;
  const end = campaign.callingHoursEnd;
  const width = (end - start) / 3;
  return {
    morning: [start, start + width],
    midday: [start + width, start + 2 * width],
    evening: [start + 2 * width, end],
  };
}

/** Which slot a local hour falls in. Hours outside the window clamp to the ends. */
export function slotForHour(hour: number, campaign: CampaignRow): Slot {
  const b = slotBounds(campaign);
  if (hour < b.midday[0]) return "morning";
  if (hour < b.evening[0]) return "midday";
  return "evening";
}

/** morning → midday → evening → morning. */
export function nextSlot(slot: Slot): Slot {
  return SLOTS[(SLOTS.indexOf(slot) + 1) % SLOTS.length];
}

/**
 * Offset between `tz` and UTC at a given instant, in ms. Formats the instant in
 * the target zone, reads those wall-clock fields back as if they were UTC, and
 * takes the difference — the standard Intl trick, and DST-correct because the
 * offset is recomputed for the specific date rather than assumed.
 */
function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const { type, value } of dtf.formatToParts(at)) {
    if (type !== "literal") p[type] = Number(value);
  }
  // Intl renders midnight as hour 24 in some locales/zones; normalize it.
  const hour = p.hour === 24 ? 0 : p.hour;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second);
  return asUtc - at.getTime();
}

/** The UTC instant for a given wall-clock hour on a given calendar day in `tz`. */
function zonedHourToUtc(
  tz: string,
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  // One correction pass is enough: the offset at `guess` and at the true instant
  // differ only when the target hour lands inside a DST transition, and the
  // second pass below settles that.
  const first = new Date(guess - tzOffsetMs(tz, new Date(guess)));
  return new Date(guess - tzOffsetMs(tz, first));
}

/** The calendar date in `tz` at a given instant. */
function zonedDateParts(tz: string, at: Date): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = dtf.format(at).split("-").map(Number);
  return { year, month, day };
}

/**
 * The next UTC instant at which `slot` begins in `timezone`, at least
 * `minDaysAhead` calendar days out. Null when the timezone is missing or
 * unusable — the caller treats that as "don't schedule".
 */
export function nextSlotStart(
  timezone: string | null,
  slot: Slot,
  campaign: CampaignRow,
  from: Date,
  minDaysAhead = 1,
): Date | null {
  if (!timezone) return null;
  let base: { year: number; month: number; day: number };
  try {
    base = zonedDateParts(timezone, from);
  } catch {
    return null; // invalid IANA zone
  }

  // Slot starts can be fractional when the window doesn't divide evenly; the
  // gate compares whole local hours, so round up to stay inside the slot.
  const startHour = Math.ceil(slotBounds(campaign)[slot][0]);

  const target = new Date(Date.UTC(base.year, base.month - 1, base.day));
  target.setUTCDate(target.getUTCDate() + minDaysAhead);
  // Roll off weekends — a Friday voicemail retried on Saturday just burns an
  // attempt. `target` is a bare calendar date, so getUTCDay is the local weekday.
  while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  const due = zonedHourToUtc(
    timezone,
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    startHour,
  );
  if (Number.isNaN(due.getTime())) return null;

  // Defensive: verify the instant really lands in the campaign's window in the
  // lead's zone. If the arithmetic drifted (exotic zone, DST edge), don't
  // schedule a follow-up the gate would only reject.
  const landedHour = localHourInTimezone(timezone, due);
  if (
    landedHour == null ||
    landedHour < campaign.callingHoursStart ||
    landedHour >= campaign.callingHoursEnd
  ) {
    return null;
  }
  return due;
}

/**
 * How many recycle-worthy outcomes (voicemail or no-answer) are already on this
 * lead's timeline. Shared across both so a lead that got one voicemail and one
 * no-answer is two attempts in, not two separate counters — the cap is on total
 * dial attempts for a lead nobody has reached.
 *
 * Counted from `lead_activities`, deliberately NOT from `call_attempts`:
 * `/api/queue/call-start` stamps console calls `source:"manual"`, and
 * `DELETE /api/console/calls?repId=` lets a rep wipe every `manual` row of
 * theirs — which would silently reset the counter and re-open a retired lead.
 * `lead_activities` is append-only (no delete path anywhere) and indexed on
 * `(lead_id, created_at)`.
 */
export async function recycleAttemptCount(leadId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(leadActivities)
    .where(
      and(
        eq(leadActivities.leadId, leadId),
        eq(leadActivities.kind, "outcome"),
        inArray(leadActivities.templateKey, ["voicemail", "no_answer"]),
      ),
    );
  return row?.n ?? 0;
}

export type CallbackPlan = {
  /** The follow-up to attach to `logOutcome`, or undefined when none is scheduled. */
  followUp?: { channel: "call"; dueAt: Date; note: string };
  /** True when this lead has exhausted its attempts and should stop being served. */
  retire: boolean;
  /** 1-based number of the attempt being saved right now. */
  attempt: number;
};

/**
 * Plan what happens after a no-answer or voicemail. Call *before* `logOutcome`,
 * which is what writes this call's activity row — so the stored count is of
 * *prior* attempts and the current attempt is `count + 1`. Also call *after* the
 * lead has been moved into the Callbacks campaign, so the slot is derived from
 * that campaign's calling window.
 *
 * At the cap we retire the lead rather than leaving it eligible-but-undialable.
 * The `already_contacted` gate would deny it forever anyway, but `claimNext`
 * would still keep picking it up and burning slots from the 25-candidate walk
 * budget on every serve — enough retired leads and reps start seeing "no callable
 * leads" while fresh ones sit behind the zombies. The caller closes the stage.
 */
export async function planCallbackRetry(
  leadId: string,
  now = new Date(),
): Promise<CallbackPlan> {
  const attempt = (await recycleAttemptCount(leadId)) + 1;
  if (attempt >= MAX_CALLBACK_ATTEMPTS) return { retire: true, attempt };

  const [lead] = await db
    .select({ timezone: leads.timezone, campaignId: leads.campaignId })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!lead?.campaignId) return { retire: false, attempt };

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, lead.campaignId))
    .limit(1);
  if (!campaign) return { retire: false, attempt };

  if (!lead.timezone) return { retire: false, attempt }; // gate hard-denies these anyway
  const hour = localHourInTimezone(lead.timezone, now);
  if (hour == null) return { retire: false, attempt }; // unusable timezone string

  const target = nextSlot(slotForHour(hour, campaign));
  const dueAt = nextSlotStart(lead.timezone, target, campaign, now);
  if (!dueAt) return { retire: false, attempt };

  const retriesAllowed = MAX_CALLBACK_ATTEMPTS - 1;
  return {
    retire: false,
    attempt,
    followUp: {
      channel: "call",
      dueAt,
      note: `Callback retry ${attempt} of ${retriesAllowed} — ${target}`,
    },
  };
}
