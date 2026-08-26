import { and, eq, inArray, isNull, isNotNull, or, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  campaigns,
  campaignReps,
  contactLedger,
  followUps,
  leads,
  reps,
  users,
} from "@/db/schema";

/** A browser rep is "online" if it heartbeat within this window. */
const ONLINE_WINDOW = "30 seconds";

/** The Twilio Voice SDK client identity for a browser rep (from its user). */
export function repClientIdentity(userId: string): string {
  return `rep_${userId}`;
}

/**
 * Ensure a browser (softphone) rep row exists for a logged-in user, and return
 * it. Browser reps are global (no campaignId) — any online one can take a call.
 */
export async function ensureBrowserRep(userId: string, name: string) {
  // Upsert instead of check-then-insert: two concurrent first-time calls for
  // the same user (e.g. token mint + heartbeat right after login, or two open
  // tabs) would otherwise both see no row and both insert.
  const [inserted] = await db
    .insert(reps)
    .values({ name, kind: "browser", userId, presence: "away" })
    .onConflictDoNothing({ target: reps.userId })
    .returning();
  if (inserted) return inserted;
  return (await db.select().from(reps).where(eq(reps.userId, userId)))[0];
}

/** Heartbeat a browser rep: online → available + fresh lastSeen, else away. */
export async function setBrowserPresence(userId: string, online: boolean) {
  await db
    .update(reps)
    .set({
      presence: online ? "available" : "away",
      lastSeen: online ? new Date() : null,
    })
    .where(eq(reps.userId, userId));
}

type NewCampaign = Partial<typeof campaigns.$inferInsert> & { name: string };

export async function createCampaign(input: NewCampaign) {
  const [row] = await db.insert(campaigns).values(input).returning();
  return row;
}

/**
 * Find-or-create the single rolling "Callbacks" campaign — the bucket that
 * no-answer and voicemail leads are recycled into for a later retry at a
 * different hour (see queue/retry-slots.ts, console/calls route).
 *
 * Created `active` but with NO reps assigned: leads accumulate in it and it is
 * only actually dialed once an admin assigns reps to it — that assignment is the
 * "run the callbacks later" switch. `campaigns_callback_target_uniq` keeps it
 * singular, so the onConflict + re-select handles two concurrent first-time
 * recycles both trying to create it.
 */
export async function ensureCallbackCampaign() {
  const find = async () =>
    (
      await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.isCallbackTarget, true))
        .limit(1)
    )[0];

  const existing = await find();
  if (existing) return existing;

  const [created] = await db
    .insert(campaigns)
    .values({ name: "Callbacks", status: "active", isCallbackTarget: true })
    .onConflictDoNothing()
    .returning();
  return created ?? (await find());
}

export async function listCampaigns() {
  return db.select().from(campaigns).orderBy(campaigns.createdAt);
}

export async function getCampaign(id: string) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return row ?? null;
}

/**
 * Delete a campaign and detach everything pointing at it.
 *
 * No `campaign_id` column has a foreign key, so nothing cascades and nothing
 * stops a delete from leaving dangling references. What happens to each
 * referrer is a judgement call, not a database default:
 *
 *  - **leads** are unassigned, not deleted. They are the expensive thing here —
 *    sourced, validated, deduped — and a campaign is just a bucket. Returning
 *    them to the unassigned pool means they can be moved to another campaign.
 *    Their claims are cleared too, so nobody is left holding a lead from a
 *    campaign that no longer exists.
 *  - **campaign_reps** rows go: membership in a deleted campaign is meaningless,
 *    and leaving them would keep reps "assigned" to nothing. Note this can leave
 *    a rep on zero campaigns, which now means they receive no leads until an
 *    admin assigns them again — that is the intended, visible consequence.
 *  - **call_attempts and follow_ups are left alone.** They are history. A call
 *    that happened still happened, and a scheduled voicemail retry still belongs
 *    to its lead. Nulling their campaign_id would quietly rewrite the record of
 *    what was done; a dangling id in an audit row is the lesser problem.
 *
 * Returns what was touched so the caller can report it rather than guess.
 */
export async function deleteCampaign(
  id: string,
): Promise<{ leadsUnassigned: number; repsUnassigned: number }> {
  return db.transaction(async (tx) => {
    const unassigned = await tx
      .update(leads)
      .set({ campaignId: null, claimedByRepId: null, claimedAt: null })
      .where(eq(leads.campaignId, id))
      .returning({ id: leads.id });

    const dropped = await tx
      .delete(campaignReps)
      .where(eq(campaignReps.campaignId, id))
      .returning({ id: campaignReps.id });

    // Legacy single-campaign pointer on phone reps, superseded by campaign_reps.
    await tx.update(reps).set({ campaignId: null }).where(eq(reps.campaignId, id));

    await tx.delete(campaigns).where(eq(campaigns.id, id));

    return { leadsUnassigned: unassigned.length, repsUnassigned: dropped.length };
  });
}

/**
 * Empty a campaign's queue so it can be refilled with a fresh list.
 *
 * Only the *unworked* remainder goes: a lead with a call attempt against it is
 * left in place, because deleting it would erase the campaign's own record of
 * what was worked while its call_attempts rows sat there pointing at nothing.
 * Leads under a live claim are left too — a rep may be mid-call on one.
 *
 * The rows are deleted rather than unassigned. "Refresh with new leads" means
 * they should be gone, and unassigning would drop them into the unassigned pool
 * where the next `assignEligibleLeads` would sweep them straight back in.
 *
 * What happens to the contact ledger is the whole point of the operation, and it
 * splits by whether the number was ever actually dialed:
 *
 *  - `callCount > 0` — **kept, always.** This is the single source of truth for
 *    "we have called this number", it outlives any lead row by design, and it is
 *    what stops the queue and the pre-dial gate handing the number back. Clearing
 *    a campaign must never be a way to forget a call that happened.
 *  - `callCount = 0` — a *found*-only row, written at ingest purely to dedupe
 *    imports. Deleted alongside the lead. Otherwise the number would be barred
 *    from ever being re-imported (`phonesInLedger` blocks it) while no lead row
 *    and no call record existed anywhere — a phone that is permanently unusable
 *    and invisible. Removing the lead has to release its import claim with it.
 *
 * Returns the counts so the caller reports what happened instead of guessing.
 */
export async function clearCampaignQueue(campaignId: string): Promise<{
  deleted: number;
  keptWorked: number;
  keptClaimed: number;
  ledgerReleased: number;
}> {
  return db.transaction(async (tx) => {
    // Unworked = no call attempt ever recorded against this lead. Checked
    // against call_attempts rather than the ledger: the ledger is keyed on
    // phone, so another lead sharing the number would wrongly protect this one.
    const removable = await tx
      .select({ id: leads.id, phone: leads.phone })
      .from(leads)
      .where(
        and(
          eq(leads.campaignId, campaignId),
          isNull(leads.claimedByRepId),
          sql`not exists (
            select 1 from call_attempts ca where ca.lead_id = ${leads.id}
          )`,
        ),
      );

    const [{ total } = { total: 0 }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.campaignId, campaignId));
    const [{ claimed } = { claimed: 0 }] = await tx
      .select({ claimed: sql<number>`count(*)::int` })
      .from(leads)
      .where(
        and(eq(leads.campaignId, campaignId), isNotNull(leads.claimedByRepId)),
      );

    if (removable.length === 0) {
      return {
        deleted: 0,
        keptWorked: total - claimed,
        keptClaimed: claimed,
        ledgerReleased: 0,
      };
    }

    const ids = removable.map((l) => l.id);
    const phones = removable
      .map((l) => l.phone)
      .filter((p): p is string => !!p);

    // Scheduled re-dials for leads that are about to stop existing.
    await tx.delete(followUps).where(inArray(followUps.leadId, ids));
    await tx.delete(leads).where(inArray(leads.id, ids));

    // Release found-only ledger claims — never the called ones. The callCount
    // predicate is what makes this safe to run on a partly-worked campaign.
    const released = phones.length
      ? await tx
          .delete(contactLedger)
          .where(
            and(
              inArray(contactLedger.phone, phones),
              eq(contactLedger.callCount, 0),
            ),
          )
          .returning({ phone: contactLedger.phone })
      : [];

    await tx.insert(auditLog).values({
      event: "campaign.queue.cleared",
      detail: {
        campaignId,
        leadsDeleted: ids.length,
        ledgerReleased: released.length,
        keptWorked: total - claimed - ids.length,
        keptClaimed: claimed,
      },
    });

    return {
      deleted: ids.length,
      keptWorked: total - claimed - ids.length,
      keptClaimed: claimed,
      ledgerReleased: released.length,
    };
  });
}

export async function setCampaignStatus(
  id: string,
  status: "draft" | "active" | "paused",
) {
  await db.update(campaigns).set({ status }).where(eq(campaigns.id, id));
}

// `addRep({name, phone})` was removed. Reps are platform users now: a row is
// created by `ensureBrowserRep` from a signed-in account, and campaign membership
// lives in `campaign_reps`. A hand-entered phone rep had no user account, so it
// could never sign in, hold a softphone identity, or take a call — the row just
// sat in the queue's rep list looking real. Existing phone rows are left alone so
// historic call_attempts still resolve; they're filtered out of the UI.

export async function setRepPresence(
  repId: string,
  presence: "available" | "away",
) {
  await db.update(reps).set({ presence }).where(eq(reps.id, repId));
}

export async function setRepOnCall(repId: string, onCall: boolean) {
  await db.update(reps).set({ onCall }).where(eq(reps.id, repId));
}

/**
 * Reps who could pick up a lead right now: available and not mid-call. Purely a
 * reporting figure for the dashboard — nothing schedules work off it, since every
 * call starts with a rep clicking Call.
 */
export async function listFreeReps(campaignId: string) {
  // Free = not on a call, AND either:
  //  - a phone rep assigned to this campaign and marked available, OR
  //  - a browser rep that is online (heartbeat within the window). Browser reps
  //    are a global pool — any online one can take a call for any campaign.
  return db
    .select()
    .from(reps)
    .where(
      and(
        eq(reps.onCall, false),
        or(
          and(
            eq(reps.kind, "phone"),
            eq(reps.campaignId, campaignId),
            eq(reps.presence, "available"),
          ),
          and(
            eq(reps.kind, "browser"),
            eq(reps.presence, "available"),
            gte(reps.lastSeen, sql`now() - interval '${sql.raw(ONLINE_WINDOW)}'`),
          ),
        ),
      ),
    );
}

/**
 * Reps working this campaign, via the campaign_reps join table.
 *
 * Legacy phone reps are excluded: reps are platform users now, and a row with a
 * phone number and no user account can't sign in, take a softphone call, or be
 * managed. The rows are left in place so historic call_attempts still resolve.
 */
export async function listCampaignReps(campaignId: string) {
  return db
    .select({
      id: reps.id,
      name: reps.name,
      kind: reps.kind,
      userId: reps.userId,
      presence: reps.presence,
      onCall: reps.onCall,
      lastSeen: reps.lastSeen,
    })
    .from(campaignReps)
    .innerJoin(reps, eq(reps.id, campaignReps.repId))
    .where(and(eq(campaignReps.campaignId, campaignId), eq(reps.kind, "browser")));
}

/**
 * Every platform user who can take calls (role `rep` or `admin`), with the
 * campaigns they're assigned to.
 *
 * Driven from `users`, not `reps`: a teammate who has signed up but never opened
 * the console has no rep row yet, and they still need to be assignable. The rep
 * row is created lazily by `assignRepToCampaign`.
 */
export async function listCallableUsers(): Promise<
  {
    userId: string;
    email: string;
    name: string | null;
    role: "rep" | "admin";
    repId: string | null;
    presence: "available" | "away" | null;
    onCall: boolean;
    campaignIds: string[];
  }[]
> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      repId: reps.id,
      presence: reps.presence,
      onCall: reps.onCall,
    })
    .from(users)
    .leftJoin(reps, eq(reps.userId, users.id))
    .where(or(eq(users.role, "rep"), eq(users.role, "admin")))
    .orderBy(users.email);

  const repIds = rows.map((r) => r.repId).filter((v): v is string => !!v);
  const links = repIds.length
    ? await db
        .select({ repId: campaignReps.repId, campaignId: campaignReps.campaignId })
        .from(campaignReps)
        .where(inArray(campaignReps.repId, repIds))
    : [];

  const byRep = new Map<string, string[]>();
  for (const l of links) {
    byRep.set(l.repId, [...(byRep.get(l.repId) ?? []), l.campaignId]);
  }

  return rows.map((r) => ({
    ...r,
    role: r.role as "rep" | "admin",
    onCall: r.onCall ?? false,
    campaignIds: r.repId ? (byRep.get(r.repId) ?? []) : [],
  }));
}

/**
 * Assign a user to a campaign, creating their rep row if this is the first time
 * anyone has touched it. Idempotent — re-assigning is a no-op.
 */
export async function assignRepToCampaign(
  userId: string,
  campaignId: string,
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("user not found");
  const rep = await ensureBrowserRep(userId, user.name ?? user.email);
  if (!rep) throw new Error("could not create a rep for this user");
  await db
    .insert(campaignReps)
    .values({ campaignId, repId: rep.id })
    .onConflictDoNothing({ target: [campaignReps.campaignId, campaignReps.repId] });
}

/** Remove a user from a campaign. Their rep row and history are untouched. */
export async function unassignRepFromCampaign(
  userId: string,
  campaignId: string,
): Promise<void> {
  const [rep] = await db.select({ id: reps.id }).from(reps).where(eq(reps.userId, userId));
  if (!rep) return;
  await db
    .delete(campaignReps)
    .where(
      and(eq(campaignReps.campaignId, campaignId), eq(campaignReps.repId, rep.id)),
    );
}

/**
 * The campaigns a rep pulls leads from.
 *
 * An empty result means "not assigned anywhere", and the queue treats that as
 * *no* leads. Campaign assignment is the grant — it is how an admin decides
 * which prospects a person may work — so an unassigned rep must see nothing
 * rather than everything.
 */
export async function repCampaignIds(repId: string): Promise<string[]> {
  const rows = await db
    .select({ campaignId: campaignReps.campaignId })
    .from(campaignReps)
    .where(eq(campaignReps.repId, repId));
  return rows.map((r) => r.campaignId);
}

export type RepCampaignOption = { id: string; name: string; waiting: number };

/**
 * The campaigns a rep may work, with how many leads are actually left to call in
 * each — what the console's campaign picker offers.
 *
 * `waiting` mirrors the predicate in `claimNext` rather than counting every lead
 * on the campaign, so the number means "leads this rep can still be handed".
 * Counting rows would read as progress that isn't there: most of a worked
 * campaign is leads the ledger now excludes.
 */
export async function repCampaignOptions(
  repId: string,
): Promise<RepCampaignOption[]> {
  const rows = await db.execute<{ id: string; name: string; waiting: number }>(sql`
    select c.id, c.name, count(l.id)::int as waiting
    from campaign_reps cr
    join campaigns c on c.id = cr.campaign_id
    left join leads l
      on l.campaign_id = c.id
      and l.validation_status = 'eligible'
      and l.phone is not null
      and l.pipeline_stage not in ('won', 'lost', 'do_not_contact')
      and (
        not exists (
          select 1 from contact_ledger cl
          where cl.phone = l.phone and cl.call_count > 0
        )
        or exists (
          select 1 from follow_ups f
          where f.lead_id = l.id and f.channel = 'call'
            and f.status = 'pending' and f.due_at <= now()
        )
      )
    where cr.rep_id = ${repId}
    group by c.id, c.name
    order by c.name asc
  `);
  return (rows as unknown as RepCampaignOption[]).map((r) => ({
    id: r.id,
    name: r.name,
    waiting: Number(r.waiting) || 0,
  }));
}

/**
 * Assign eligible, unassigned leads to a campaign. Only dial-eligible leads that
 * aren't already in another campaign are pulled in (spec frequency rule: a lead
 * shouldn't be live in two campaigns at once).
 */
export async function assignEligibleLeads(campaignId: string, limit = 1000) {
  const eligible = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(eq(leads.validationStatus, "eligible"), isNull(leads.campaignId)),
    )
    .limit(limit);

  if (eligible.length === 0) return 0;
  for (const l of eligible) {
    await db
      .update(leads)
      .set({ campaignId })
      .where(eq(leads.id, l.id));
  }
  return eligible.length;
}

/**
 * Assign the eligible leads from ONE ingestion batch to a campaign. Scoped to the
 * batch so that, with multiple sheets importing into different campaigns, a sheet's
 * leads never get swept into another sheet's campaign (which unscoped
 * assignEligibleLeads would do). No-op when campaignId is null.
 */
export async function assignBatchLeads(
  batchId: string,
  campaignId: string | null,
): Promise<number> {
  if (!campaignId) return 0;
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.ingestionBatchId, batchId),
        eq(leads.validationStatus, "eligible"),
        isNull(leads.campaignId),
      ),
    );
  for (const l of rows) {
    await db.update(leads).set({ campaignId }).where(eq(leads.id, l.id));
  }
  return rows.length;
}

/** Dial-eligible leads currently assigned to a campaign. */
export async function listCampaignLeads(campaignId: string) {
  return db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.campaignId, campaignId),
        eq(leads.validationStatus, "eligible"),
      ),
    );
}
