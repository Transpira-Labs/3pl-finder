import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, campaigns, contactLedger, followUps, leads } from "@/db/schema";
import { checkDialable, type PredialDecision } from "@/lib/compliance/predial";
import { repCampaignIds } from "@/lib/campaigns/service";
import { recordPriorContact } from "@/lib/pipeline/ledger";

/**
 * The shared calling queue.
 *
 * One pool for every rep. A rep asks for the next lead, that lead is *claimed*
 * for them, and no one else can be handed it while the claim holds. The claim is
 * taken inside a single `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`
 * statement, which is what makes two reps clicking at the same instant
 * impossible to collide: each transaction skips the row the other has locked and
 * takes the next one instead. No application-level lock, no race window.
 *
 * Claims expire (CLAIM_TTL_MINUTES) so a rep who closes their tab mid-lead
 * doesn't strand it — the next scan treats an expired claim as unclaimed.
 *
 * Every candidate still passes `checkDialable` before it is shown, so a lead a
 * rep can't legally call now (outside calling hours, capped, cooling down, on a
 * suppression list) is never put in front of them.
 */

/** How long a served lead stays locked to its rep before returning to the pool. */
export const CLAIM_TTL_MINUTES = 15;

/** How many blocked candidates to walk past before giving up on this request. */
const MAX_CANDIDATES = 25;

/** Pipeline stages that mean "don't call this again". */
const CLOSED_STAGES = sql.raw(`('won', 'lost', 'do_not_contact')`);

/** Postgres interval literal for the claim TTL (a constant, never user input). */
const CLAIM_TTL = sql.raw(`interval '${CLAIM_TTL_MINUTES} minutes'`);

export type QueueLead = {
  id: string;
  phone: string;
  name: string | null;
  company: string | null;
  website: string | null;
  email: string | null;
  notes: string | null;
  timezone: string | null;
  source: string | null;
  campaignId: string | null;
  localTime: string | null;
};

type LeadRow = typeof leads.$inferSelect;

function toQueueLead(lead: LeadRow, localTime: string | null): QueueLead {
  return {
    id: lead.id,
    phone: lead.phone ?? "",
    name: lead.name,
    company: lead.company,
    website: lead.website,
    email: lead.email,
    notes: lead.notes,
    timezone: lead.timezone,
    source: lead.source,
    campaignId: lead.campaignId,
    localTime,
  };
}

/**
 * The lead this rep currently holds, if any. Checked before claiming a new one
 * so a page reload hands the rep back the same prospect instead of skipping it.
 */
export async function getClaimedLead(repId: string): Promise<LeadRow | null> {
  const rows = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.claimedByRepId, repId),
        sql`${leads.claimedAt} > now() - ${CLAIM_TTL}`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Atomically claim the next candidate for this rep. `campaignIds` scopes the scan
 * to the campaigns this rep is assigned to; an empty list means "unrestricted",
 * so a rep nobody has assigned yet still draws from the whole pool rather than
 * silently receiving nothing.
 *
 * `skip` holds leads this request already rejected on compliance grounds, so the
 * walk makes progress instead of re-claiming the same blocked lead forever.
 */
async function claimNext(
  repId: string,
  campaignIds: string[],
  skip: string[],
): Promise<LeadRow | null> {
  // Expanded into a bound parameter per id rather than `= any($1::uuid[])`.
  // Drizzle binds a JS array as a single opaque parameter, and Postgres rejects
  // it with 22P02 ("Array value must start with {") before the ::uuid[] cast is
  // ever reached — the whole statement throws, the route 500s, and the rep sees
  // "Couldn't reach the lead queue". Each id is still a placeholder, so this is
  // no more injectable than the array form was meant to be.
  const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

  // Always scoped. serveNext refuses to call this with an empty list, so there
  // is no "unscoped" path that could hand a rep a lead outside their campaigns.
  const campaignFilter = sql`and l.campaign_id in (${idList(campaignIds)})`;
  const skipFilter =
    skip.length > 0 ? sql`and l.id not in (${idList(skip)})` : sql``;

  // Raw SQL because `FOR UPDATE SKIP LOCKED` has no query-builder equivalent.
  // It returns only the id: a raw `returning *` hands back snake_case columns
  // that don't map onto the typed row, so we re-read through drizzle instead.
  const claimed = await db.execute<{ id: string }>(sql`
    update leads set
      claimed_by_rep_id = ${repId},
      claimed_at = now(),
      last_served_at = now()
    where id = (
      select l.id from leads l
      where l.validation_status = 'eligible'
        and l.phone is not null
        and l.campaign_id is not null
        and l.pipeline_stage not in ${CLOSED_STAGES}
        and (l.claimed_at is null or l.claimed_at < now() - ${CLAIM_TTL})
        ${campaignFilter}
        ${skipFilter}
        -- Skip numbers already dialed, unless a re-dial is due. This mirrors the
        -- already_contacted check in checkDialable, which stays the authority —
        -- the gate still runs on whatever this returns. The point is to stop
        -- *claiming* leads the gate will certainly reject: each rejection costs a
        -- claim, eight gate round trips and a release, and burns one of
        -- MAX_CANDIDATES. Without this, the walk degrades as the campaign is
        -- worked through, until a serve times out and the rep sees "couldn't
        -- reach the lead queue". Keyed on phone, like the ledger itself, so a
        -- number that arrived as two lead rows is still only called once.
        and (
          not exists (
            select 1 from contact_ledger cl
            where cl.phone = l.phone and cl.call_count > 0
          )
          or exists (
            select 1 from follow_ups f
            where f.lead_id = l.id
              and f.channel = 'call'
              and f.status = 'pending'
              and f.due_at <= now()
          )
        )
      -- Due re-dials first (a voicemail retry that has come round, or a callback
      -- the lead asked for): those are time-sensitive in a way a cold lead isn't,
      -- and a retry scheduled into a specific time-of-day slot loses its point if
      -- it waits behind the whole pool. Then never-served leads, then the
      -- longest-untouched — skipping a lead stamps last_served_at, which sinks it.
      order by
        (exists (
          select 1 from follow_ups f
          where f.lead_id = l.id
            and f.channel = 'call'
            and f.status = 'pending'
            and f.due_at <= now()
        )) desc,
        l.last_served_at asc nulls first,
        l.created_at asc
      limit 1
      for update skip locked
    )
    returning id
  `);

  const id = (claimed as unknown as { id: string }[])[0]?.id;
  if (!id) return null;
  const rows = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Release a claim so the lead returns to the pool immediately. */
export async function releaseClaim(leadId: string, repId: string): Promise<void> {
  await db
    .update(leads)
    .set({ claimedByRepId: null, claimedAt: null })
    .where(and(eq(leads.id, leadId), eq(leads.claimedByRepId, repId)));
}

export type ServeResult =
  | { lead: QueueLead; blocked: number }
  | { lead: null; blocked: number; reason: string };

/**
 * Hand this rep their next callable lead.
 *
 * Returns the rep's existing claim if they still hold one (re-verified against
 * the gate — a lead can fall out of its calling window while it sits on screen).
 * Otherwise walks the queue, claiming and gate-checking candidates until one
 * passes. Candidates that fail are released, not consumed.
 */
export async function serveNext(
  repId: string,
  /**
   * Narrow this serve to one campaign. A rep preference, not a grant — it can
   * only ever be a subset of what they're assigned, never a way to reach a
   * campaign they aren't on.
   */
  focusCampaignId?: string | null,
): Promise<ServeResult> {
  const skip: string[] = [];
  let blocked = 0;

  // Which campaigns this rep works. Resolved here rather than passed in, so the
  // caller can't hand us a campaign the rep isn't assigned to.
  const assigned = await repCampaignIds(repId);

  // A rep with no campaign sees nothing. Campaign assignment is the grant: it is
  // how an admin decides which prospects a person may work, so "unassigned"
  // has to mean "no leads", not "every lead". Onboarding is deliberately inert
  // until an admin acts.
  if (assigned.length === 0) {
    return {
      lead: null,
      blocked: 0,
      reason:
        "You're not on a campaign yet. An admin needs to assign you one before leads appear here.",
    };
  }

  // Say so rather than quietly widening back to every campaign: the selection
  // going stale mid-shift (an admin unassigning them) would otherwise look like
  // the filter silently doing nothing.
  if (focusCampaignId && !assigned.includes(focusCampaignId)) {
    return {
      lead: null,
      blocked: 0,
      reason: "You're not assigned to that campaign any more. Pick another one.",
    };
  }

  const campaignIds = focusCampaignId ? [focusCampaignId] : assigned;

  const held = await getClaimedLead(repId);
  // A claim taken before the rep was moved off a campaign must not survive the
  // change — otherwise removing someone leaves them holding a live lead.
  let candidate =
    held && held.campaignId && campaignIds.includes(held.campaignId) ? held : null;
  if (held && !candidate) await releaseClaim(held.id, repId);

  for (let i = 0; i < MAX_CANDIDATES; i++) {
    if (!candidate) candidate = await claimNext(repId, campaignIds, skip);
    if (!candidate) {
      return {
        lead: null,
        blocked,
        reason:
          blocked > 0
            ? "No callable leads right now — the remaining leads are outside calling hours or in cooldown."
            : "The queue is empty. Import more leads, or assign them to this campaign.",
      };
    }

    const decision = await gateFor(candidate);
    if (decision.allowed) {
      return { lead: toQueueLead(candidate, decision.localTime), blocked };
    }

    // Not callable now — hand it back and try the next one.
    blocked++;
    skip.push(candidate.id);
    await releaseClaim(candidate.id, repId);
    candidate = null;
  }

  return {
    lead: null,
    blocked,
    reason: `Checked ${MAX_CANDIDATES} leads and none are callable right now.`,
  };
}

export type ClaimResult =
  | { ok: true; lead: QueueLead }
  | { ok: false; status: number; error: string; reason?: string };

/**
 * Claim one *named* lead for this rep — the pipeline's "call this specific
 * person" path, as opposed to serveNext's "hand me whoever is next".
 *
 * Everything that makes the queue path safe still holds here: the lead must be
 * on a campaign the rep is assigned to, the claim is taken atomically so two
 * reps can't hold the same prospect, and the compliance gate has the final
 * word — this function only ever *selects* a lead, it never widens what may be
 * dialed. Dialing still goes through /api/queue/call-start unchanged.
 *
 * The one deliberate difference: picking a lead by name is a *deliberate*
 * re-contact, so a number the ledger already counts as called is let back in
 * via the sanctioned re-dial path — a due pending `call` follow-up (created or
 * pulled forward here). The gate's other checks (DNC, suppression, consent,
 * calling hours, frequency cap, cooldown) still apply and still deny.
 */
export async function claimSpecificLead(
  leadId: string,
  repId: string,
): Promise<ClaimResult> {
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, status: 404, error: "lead not found" };
  if (!lead.phone) {
    return { ok: false, status: 409, error: "This lead has no callable number." };
  }
  // The stage a lead reaches when someone opts out. The gate would catch the
  // suppression-list entry anyway; this is the clearer message for the case.
  if (lead.pipelineStage === "do_not_contact") {
    return { ok: false, status: 403, error: "This lead asked not to be contacted." };
  }

  // Same grant model as every serve: campaign assignment decides which
  // prospects a person may work, and picking by name doesn't change that.
  const assigned = await repCampaignIds(repId);
  if (!lead.campaignId || !assigned.includes(lead.campaignId)) {
    return {
      ok: false,
      status: 403,
      error: "This lead isn't on one of your campaigns.",
    };
  }

  // One claim per rep: hand back whatever else they were holding first.
  const held = await getClaimedLead(repId);
  if (held && held.id !== lead.id) await releaseClaim(held.id, repId);

  // Atomic take of this specific row — the same collision rule as claimNext,
  // just without the scan. Re-claiming a lead this rep already holds is a no-op
  // refresh of the TTL, so a double-click or reload can't lock the rep out.
  const claimed = await db.execute<{ id: string }>(sql`
    update leads set
      claimed_by_rep_id = ${repId},
      claimed_at = now(),
      last_served_at = now()
    where id = ${lead.id}
      and (
        claimed_by_rep_id = ${repId}
        or claimed_at is null
        or claimed_at < now() - ${CLAIM_TTL}
      )
    returning id
  `);
  if (!(claimed as unknown as { id: string }[])[0]?.id) {
    return {
      ok: false,
      status: 409,
      error: "Another rep is working this lead right now.",
    };
  }

  const undoFollowUp = await ensureDueCallFollowUp(lead, repId);

  const decision = await gateFor(lead);
  if (!decision.allowed) {
    // Leave no trace of the attempt: the follow-up change is undone so a denied
    // claim doesn't quietly promote this lead to the front of the shared queue.
    await undoFollowUp();
    await releaseClaim(lead.id, repId);
    return {
      ok: false,
      status: 403,
      error: "blocked by compliance",
      reason: decision.reason ?? decision.failedCheck ?? undefined,
    };
  }

  await db.insert(auditLog).values({
    event: "queue.direct_claim",
    subjectPhone: lead.phone,
    detail: { leadId: lead.id, repId, campaignId: lead.campaignId },
  });

  return { ok: true, lead: toQueueLead(lead, decision.localTime) };
}

/**
 * Let a deliberately-picked, already-called lead back through the ledger dedupe
 * by making sure it has a due pending `call` follow-up — the same mechanism a
 * scheduled callback uses, so the rest of the system needs no new cases: the
 * gate honors it, and saving the finished call marks it done
 * (completePendingCallFollowUps). A future-scheduled callback is pulled forward
 * rather than duplicated.
 *
 * Returns an undo, so a claim the gate then denies can put things back exactly
 * as they were.
 */
async function ensureDueCallFollowUp(
  lead: LeadRow,
  repId: string,
): Promise<() => Promise<void>> {
  const noop = async () => {};
  if (!lead.phone) return noop;

  const [ledgerRow] = await db
    .select({ callCount: contactLedger.callCount })
    .from(contactLedger)
    .where(eq(contactLedger.phone, lead.phone))
    .limit(1);
  // Never called → the gate doesn't need a follow-up to allow it.
  if (!ledgerRow || ledgerRow.callCount === 0) return noop;

  const now = new Date();
  const [pending] = await db
    .select()
    .from(followUps)
    .where(
      and(
        eq(followUps.leadId, lead.id),
        eq(followUps.channel, "call"),
        eq(followUps.status, "pending"),
      ),
    )
    .orderBy(asc(followUps.dueAt))
    .limit(1);

  if (pending && pending.dueAt <= now) return noop; // already due as-is

  if (pending) {
    await db
      .update(followUps)
      .set({ dueAt: now })
      .where(eq(followUps.id, pending.id));
    return async () => {
      await db
        .update(followUps)
        .set({ dueAt: pending.dueAt })
        .where(eq(followUps.id, pending.id));
    };
  }

  const [created] = await db
    .insert(followUps)
    .values({
      leadId: lead.id,
      campaignId: lead.campaignId,
      repId,
      channel: "call",
      dueAt: now,
      note: "Direct call from the pipeline",
    })
    .returning({ id: followUps.id });
  return async () => {
    await db.delete(followUps).where(eq(followUps.id, created.id));
  };
}

/**
 * Run the pre-dial compliance gate for a lead using its own campaign's rules.
 * Exported because /api/queue/call-start re-runs it at the moment of dialing —
 * being served a lead is not permission to dial it minutes later.
 */
export async function gateFor(
  lead: LeadRow,
  opts: { excludeAttemptId?: string } = {},
): Promise<PredialDecision> {
  const base = {
    allowed: false as const,
    leadId: lead.id,
    phone: lead.phone ?? "",
    localTime: null,
  };
  if (!lead.campaignId) {
    return { ...base, failedCheck: "eligible", reason: "lead has no campaign" };
  }
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, lead.campaignId))
    .limit(1);
  if (!campaign) {
    return { ...base, failedCheck: "eligible", reason: "campaign not found" };
  }
  return checkDialable(lead, campaign, new Date(), opts);
}

/** Load one lead by id (used by the call-start and TwiML routes). */
export async function getLead(leadId: string): Promise<LeadRow | null> {
  const rows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  return rows[0] ?? null;
}

/** How far a skip pushes a re-dial that had already come due. */
const SKIP_DEFER_MS = 60 * 60 * 1000;

/**
 * Skip: release the claim and push the lead to the back of the queue. The
 * `last_served_at` stamp set when it was claimed already does the sinking, so
 * for an ordinary lead this is just the release plus a guard on ownership.
 *
 * A lead whose re-dial has come due is the exception. Those sort ahead of every
 * cold lead in claimNext and stay there until the follow-up stops being due, so
 * releasing alone puts the lead straight back at the front — with a handful of
 * them the rep rotates between the same few and never reaches the fresh pool at
 * all. Skipping means "not now", so the re-dial moves accordingly and the
 * priority tier drains instead of trapping the queue.
 */
export async function skipLead(leadId: string, repId: string): Promise<void> {
  await db
    .update(followUps)
    .set({ dueAt: new Date(Date.now() + SKIP_DEFER_MS) })
    .where(
      and(
        eq(followUps.leadId, leadId),
        eq(followUps.channel, "call"),
        eq(followUps.status, "pending"),
        lte(followUps.dueAt, new Date()),
      ),
    );
  await releaseClaim(leadId, repId);
}

/**
 * "I've already called this one" — the rep recognises a number they worked
 * before this platform existed, and it should stop coming round.
 *
 * Skip is the wrong tool for that: it only sinks the lead to the back, so the
 * same number resurfaces once the pool cycles. This writes the prior contact to
 * the contact ledger instead, which is what both queue layers already read —
 * the claim scan stops selecting it (service.ts claimNext) and `checkDialable`
 * denies it as `already_contacted`. No new flag, and it holds across campaigns
 * and re-imports because the ledger is keyed on phone, not lead id.
 *
 * Only the rep holding the claim may declare it, so this can't be used to bury
 * a lead sitting on someone else's screen.
 *
 * Returns false when the caller doesn't hold the claim (a stale tab, or an
 * expired claim someone else has since taken).
 */
export async function markAlreadyContacted(
  leadId: string,
  repId: string,
): Promise<boolean> {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.claimedByRepId, repId)))
    .limit(1);
  if (!lead || !lead.phone) return false;

  await db.transaction(async (tx) => {
    await recordPriorContact(lead.phone as string, lead.id, tx);

    // Cancel any scheduled re-dial. The ledger alone doesn't retire the lead:
    // claimNext deliberately overrides the ledger for a follow-up that has come
    // due, and sorts those first — so a lead with a pending retry outranks the
    // entire fresh pool and comes straight back, no matter how many times it's
    // declared. A voicemail retry is exactly that case, and it's the common one.
    // Declaring prior contact is a request to stop being handed this number, so
    // the retry has to go with it.
    await tx
      .update(followUps)
      .set({ status: "canceled", completedAt: new Date() })
      .where(
        and(
          eq(followUps.leadId, lead.id),
          eq(followUps.channel, "call"),
          eq(followUps.status, "pending"),
        ),
      );

    // Mirror it onto the lead so the campaign view explains where the lead went.
    // Stage `contacted`, not `do_not_contact`: the rep said they'd spoken to this
    // number, not that it opted out — conflating the two would quietly build a
    // suppression list out of ordinary prior contact.
    await tx
      .update(leads)
      .set({
        pipelineStage: "contacted",
        // Record the declaration even when a disposition is already set. Keeping
        // the old one (`voicemail`, say) left the lead looking untouched, so a
        // rep declaring it repeatedly got no feedback that anything had happened.
        disposition: "prior_contact",
        claimedByRepId: null,
        claimedAt: null,
      })
      .where(eq(leads.id, lead.id));

    // The ledger row itself can't say who declared it or when — it deliberately
    // carries no timestamp for a call it didn't observe. This is that record.
    await tx.insert(auditLog).values({
      event: "lead.prior_contact.declared",
      subjectPhone: lead.phone,
      detail: { leadId: lead.id, repId, campaignId: lead.campaignId },
    });
  });

  return true;
}
