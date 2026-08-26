import { inArray, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contactLedger } from "@/db/schema";

/**
 * Contact ledger — THE persistent, universal contact log (spec §2). Keyed by
 * phone (E.164) so a number is never re-found on ingest nor re-called on dial,
 * across sessions, even if the originating lead row is later quarantined/deleted.
 * Records both dials (recordCalled) and SMS/email follow-ups (recordMessaged), so
 * "reached out?" has one answer per number. These are the only writers/readers of
 * `contact_ledger`.
 */

/** A drizzle transaction handle, so callers can enroll ledger writes in a tx. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Record that a set of phones were "found" (ingested). Idempotent per phone:
 * the first claim wins (`onConflictDoNothing`), so re-ingesting a number never
 * disturbs its original provenance. Runs inside `tx` when supplied so it commits
 * atomically with the lead insert.
 */
export async function recordFound(
  phones: { phone: string; leadId: string }[],
  tx?: Tx,
): Promise<void> {
  if (phones.length === 0) return;
  const conn = tx ?? db;
  await conn
    .insert(contactLedger)
    .values(phones.map((p) => ({ phone: p.phone, leadId: p.leadId })))
    .onConflictDoNothing({ target: contactLedger.phone });
}

/**
 * Record that a phone was "called" (dial released / manual console call). Upserts
 * the ledger row: stamps firstCalledAt on the first-ever call, always bumps
 * lastCalledAt=now and callCount+1. leadId only fills a previously-null slot.
 */
export async function recordCalled(
  phone: string,
  leadId?: string,
  tx?: Tx,
): Promise<void> {
  const conn = tx ?? db;
  const now = new Date();
  await conn
    .insert(contactLedger)
    .values({
      phone,
      leadId: leadId ?? null,
      firstCalledAt: now,
      lastCalledAt: now,
      callCount: 1,
    })
    .onConflictDoUpdate({
      target: contactLedger.phone,
      set: {
        lastCalledAt: sql`now()`,
        callCount: sql`${contactLedger.callCount} + 1`,
        firstCalledAt: sql`coalesce(${contactLedger.firstCalledAt}, now())`,
        leadId: sql`coalesce(${contactLedger.leadId}, ${leadId ?? null})`,
      },
    });
}

/**
 * Record that a phone was "messaged" (an SMS/email follow-up was sent to this
 * number's lead). Upserts the ledger row exactly like recordCalled but on the
 * message columns, so the ledger stays the single answer to "reached out?"
 * regardless of channel. Does NOT affect callCount, so it never blocks or permits
 * a dial — the pre-dial gate keys on calls only.
 */
export async function recordMessaged(
  phone: string,
  leadId?: string,
  tx?: Tx,
): Promise<void> {
  const conn = tx ?? db;
  const now = new Date();
  await conn
    .insert(contactLedger)
    .values({
      phone,
      leadId: leadId ?? null,
      firstMessagedAt: now,
      lastMessagedAt: now,
      messageCount: 1,
    })
    .onConflictDoUpdate({
      target: contactLedger.phone,
      set: {
        lastMessagedAt: sql`now()`,
        messageCount: sql`${contactLedger.messageCount} + 1`,
        firstMessagedAt: sql`coalesce(${contactLedger.firstMessagedAt}, now())`,
        leadId: sql`coalesce(${contactLedger.leadId}, ${leadId ?? null})`,
      },
    });
}

/**
 * Record that a phone was contacted *before this platform existed* — a rep
 * recognising a number they already worked elsewhere. Same effect on the queue
 * as `recordCalled` (callCount > 0 is what both the claim scan and the
 * already_contacted gate read), but deliberately NOT the same write:
 *
 *  - `callCount` goes to at least 1 via `greatest`, never +1. This is a
 *    declaration that prior contact happened, not another dial; incrementing
 *    would let repeated clicks inflate a number nothing else can correct.
 *  - `firstCalledAt`/`lastCalledAt` are left as they are — usually null. We
 *    genuinely don't know when the earlier call happened, and stamping now()
 *    would put a date in the ledger that no call ever produced.
 *
 * Deliberately silent on the message columns too: declaring a prior *call* says
 * nothing about whether anyone ever texted or emailed the number.
 *
 * Who declared it, and when, lives in `audit_log` — see markAlreadyContacted.
 */
export async function recordPriorContact(
  phone: string,
  leadId?: string,
  tx?: Tx,
): Promise<void> {
  const conn = tx ?? db;
  await conn
    .insert(contactLedger)
    .values({ phone, leadId: leadId ?? null, callCount: 1 })
    .onConflictDoUpdate({
      target: contactLedger.phone,
      set: {
        callCount: sql`greatest(${contactLedger.callCount}, 1)`,
        leadId: sql`coalesce(${contactLedger.leadId}, ${leadId ?? null})`,
      },
    });
}

/** Which of the given phones already exist in the ledger (found OR called). */
export async function phonesInLedger(phones: string[]): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const rows = await db
    .select({ phone: contactLedger.phone })
    .from(contactLedger)
    .where(inArray(contactLedger.phone, phones));
  return new Set(rows.map((r) => r.phone));
}

/** True when this phone has been dialed at least once (callCount > 0). */
export async function hasBeenCalled(phone: string): Promise<boolean> {
  const [row] = await db
    .select({ callCount: contactLedger.callCount })
    .from(contactLedger)
    .where(eq(contactLedger.phone, phone))
    .limit(1);
  return (row?.callCount ?? 0) > 0;
}
