import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  lte,
  or,
} from "drizzle-orm";
import { db } from "@/db";
import {
  leads,
  leadActivities,
  followUps,
  callAttempts,
  auditLog,
  pipelineStageEnum,
} from "@/db/schema";
import { OUTCOME_TEMPLATES } from "@/lib/config";
import { recordOptOut } from "@/lib/compliance/predial";

/**
 * Pipeline service (spec §4) — thin drizzle functions backing the /pipeline
 * feature: stage tracking, the chat-bubble activity timeline, one-click outcome
 * documentation, and the follow-up due queue. Written in the campaigns/service.ts
 * dialect: small exported fns, `db.transaction` for multi-writes, `audit_log`
 * appends for significant decisions.
 */

export type PipelineStage = (typeof pipelineStageEnum.enumValues)[number];
const STAGES = pipelineStageEnum.enumValues;

type LeadRow = typeof leads.$inferSelect;
type Activity = typeof leadActivities.$inferSelect;
type FollowUp = typeof followUps.$inferSelect;

export type PipelineLead = {
  id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  timezone: string | null;
  pipelineStage: PipelineStage;
  lastContacted: Date | null;
  createdAt: Date;
  campaignId: string | null;
  nextFollowUp: FollowUp | null;
  lastActivity: Activity | null;
};

export type CallAttemptSummary = {
  id: string;
  finalState: string | null;
  disposition: string | null;
  startedAt: Date;
  endedAt: Date | null;
  reachedHuman: boolean;
  bridged: boolean;
};

/** Human label for a pipeline stage, e.g. "do_not_contact" → "Do not contact". */
function stageLabel(stage: string): string {
  const words = stage.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Compact, human-readable due date for follow-up activity bubbles. */
function formatDue(due: Date): string {
  return due.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paginated list of eligible leads for the pipeline board. Each row carries its
 * next pending follow-up and latest timeline activity for at-a-glance context.
 */
export async function listPipelineLeads(params: {
  stage?: PipelineStage;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ leads: PipelineLead[]; total: number }> {
  const { stage, q, limit = 50, offset = 0 } = params;

  const conds = [eq(leads.validationStatus, "eligible")];
  if (stage) conds.push(eq(leads.pipelineStage, stage));
  if (q && q.trim()) {
    const pat = `%${q.trim()}%`;
    const search = or(
      ilike(leads.name, pat),
      ilike(leads.company, pat),
      ilike(leads.phone, pat),
    );
    if (search) conds.push(search);
  }
  const where = and(...conds);

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(leads)
    .where(where);

  const rows = await db
    .select()
    .from(leads)
    .where(where)
    .orderBy(desc(leads.createdAt))
    .limit(limit)
    .offset(offset);

  const ids = rows.map((r) => r.id);

  // Next pending follow-up (earliest due) + latest activity, per lead on the page.
  const pendingFollowUps = ids.length
    ? await db
        .select()
        .from(followUps)
        .where(
          and(inArray(followUps.leadId, ids), eq(followUps.status, "pending")),
        )
        .orderBy(asc(followUps.dueAt))
    : [];
  const recentActivities = ids.length
    ? await db
        .select()
        .from(leadActivities)
        .where(inArray(leadActivities.leadId, ids))
        .orderBy(desc(leadActivities.createdAt))
    : [];

  const nextByLead = new Map<string, FollowUp>();
  for (const f of pendingFollowUps) if (!nextByLead.has(f.leadId)) nextByLead.set(f.leadId, f);
  const lastByLead = new Map<string, Activity>();
  for (const a of recentActivities) if (!lastByLead.has(a.leadId)) lastByLead.set(a.leadId, a);

  const list: PipelineLead[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    company: r.company,
    phone: r.phone,
    timezone: r.timezone,
    pipelineStage: r.pipelineStage,
    lastContacted: r.lastContacted,
    createdAt: r.createdAt,
    campaignId: r.campaignId,
    nextFollowUp: nextByLead.get(r.id) ?? null,
    lastActivity: lastByLead.get(r.id) ?? null,
  }));

  return { leads: list, total };
}

/** Full detail for one lead: the lead, its timeline, follow-ups, and calls. */
export async function getLeadDetail(leadId: string): Promise<{
  lead: LeadRow;
  activities: Activity[];
  followUps: FollowUp[];
  callAttempts: CallAttemptSummary[];
} | null> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return null;

  const [activities, followUpRows, attempts] = await Promise.all([
    db
      .select()
      .from(leadActivities)
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(asc(leadActivities.createdAt)),
    db
      .select()
      .from(followUps)
      .where(eq(followUps.leadId, leadId))
      .orderBy(desc(followUps.createdAt)),
    db
      .select({
        id: callAttempts.id,
        finalState: callAttempts.finalState,
        disposition: callAttempts.disposition,
        startedAt: callAttempts.startedAt,
        endedAt: callAttempts.endedAt,
        reachedHuman: callAttempts.reachedHuman,
        bridged: callAttempts.bridged,
      })
      .from(callAttempts)
      .where(eq(callAttempts.leadId, leadId))
      .orderBy(desc(callAttempts.startedAt)),
  ]);

  return { lead, activities, followUps: followUpRows, callAttempts: attempts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/** Advance a lead's pipeline stage, timeline it, and audit it. */
export async function setStage(
  leadId: string,
  stage: PipelineStage,
  opts: { repId?: string; reason?: string } = {},
): Promise<LeadRow> {
  return db.transaction(async (tx) => {
    const [lead] = await tx
      .update(leads)
      .set({ pipelineStage: stage })
      .where(eq(leads.id, leadId))
      .returning();
    if (!lead) throw new Error(`lead ${leadId} not found`);

    await tx.insert(leadActivities).values({
      leadId,
      repId: opts.repId ?? null,
      kind: "stage_change",
      body: `Stage → ${stageLabel(stage)}`,
      meta: { stage, reason: opts.reason ?? null },
    });

    await tx.insert(auditLog).values({
      event: "pipeline.stage.changed",
      subjectPhone: lead.phone,
      detail: { leadId, stage, repId: opts.repId ?? null, reason: opts.reason ?? null },
    });

    return lead;
  });
}

/**
 * One-click / free-text outcome logging (spec §3/§4). ONE transaction:
 *   1. insert the outcome/note activity bubble,
 *   2. update the lead's stage (explicit > template > unchanged), disposition,
 *      and lastContacted,
 *   3. optionally schedule a follow-up (+ its own timeline bubble).
 * `do_not_call` additionally routes the number through recordOptOut (after the
 * tx commits, since recordOptOut is not tx-scoped and touches the same lead row).
 */
export async function logOutcome(
  leadId: string,
  input: {
    kind?: "outcome" | "note";
    templateKey?: string | null;
    body: string;
    repId?: string | null;
    callAttemptId?: string | null;
    stage?: PipelineStage | null;
    followUp?: {
      channel: "call" | "email";
      // Accepts a Date or an ISO string (the HTTP layer passes the raw ISO string).
      dueAt: Date | string;
      note?: string | null;
    } | null;
  },
): Promise<{ activity: Activity; lead: LeadRow; followUp?: FollowUp }> {
  const template = input.templateKey
    ? OUTCOME_TEMPLATES.find((t) => t.key === input.templateKey)
    : undefined;
  const kind = input.kind ?? (input.templateKey ? "outcome" : "note");

  const result = await db.transaction(async (tx) => {
    const [activity] = await tx
      .insert(leadActivities)
      .values({
        leadId,
        repId: input.repId ?? null,
        callAttemptId: input.callAttemptId ?? null,
        kind,
        templateKey: input.templateKey ?? null,
        body: input.body,
      })
      .returning();

    // Stage: explicit wins, else template stage, else leave unchanged.
    const nextStage: PipelineStage | null =
      input.stage ?? (template ? (template.stage as PipelineStage) : null);

    const leadSet: Partial<typeof leads.$inferInsert> = {
      disposition: input.templateKey ?? "custom",
      lastContacted: new Date(),
    };
    if (nextStage) leadSet.pipelineStage = nextStage;

    const [lead] = await tx
      .update(leads)
      .set(leadSet)
      .where(eq(leads.id, leadId))
      .returning();
    if (!lead) throw new Error(`lead ${leadId} not found`);

    let followUp: FollowUp | undefined;
    if (input.followUp) {
      const dueAt =
        input.followUp.dueAt instanceof Date
          ? input.followUp.dueAt
          : new Date(input.followUp.dueAt);
      const [fu] = await tx
        .insert(followUps)
        .values({
          leadId,
          campaignId: lead.campaignId ?? null,
          repId: input.repId ?? null,
          channel: input.followUp.channel,
          dueAt,
          note: input.followUp.note ?? null,
        })
        .returning();
      followUp = fu;

      const verb = input.followUp.channel === "call" ? "call again" : "email";
      await tx.insert(leadActivities).values({
        leadId,
        repId: input.repId ?? null,
        kind: "followup",
        body: `Follow-up scheduled: ${verb} ${formatDue(dueAt)}`,
        meta: { followUpId: fu.id, channel: input.followUp.channel },
      });
    }

    return { activity, lead, followUp };
  });

  // Opt-out is the compliance path — reuse recordOptOut, don't duplicate it.
  // Run it after the tx commits: it uses the global db connection and updates the
  // same lead row, so calling it inside the open transaction would deadlock.
  if (input.templateKey === "do_not_call" && result.lead.phone) {
    await recordOptOut(result.lead.phone, "outcome: do_not_call");
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Follow-up queue
// ─────────────────────────────────────────────────────────────────────────────

export type FollowUpWithLead = FollowUp & {
  lead: {
    id: string;
    name: string | null;
    company: string | null;
    phone: string | null;
    pipelineStage: PipelineStage;
  };
};

/** The due queue, joined with its lead. `dueOnly` filters to already-due items. */
export async function listFollowUps(params: {
  status?: "pending" | "done" | "canceled";
  dueOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ followUps: FollowUpWithLead[]; total: number }> {
  const { status = "pending", dueOnly = false, limit = 50, offset = 0 } = params;

  const conds = [eq(followUps.status, status)];
  if (dueOnly) conds.push(lte(followUps.dueAt, new Date()));
  const where = and(...conds);

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(followUps)
    .where(where);

  const rows = await db
    .select({
      followUp: followUps,
      leadId: leads.id,
      leadName: leads.name,
      leadCompany: leads.company,
      leadPhone: leads.phone,
      leadStage: leads.pipelineStage,
    })
    .from(followUps)
    .innerJoin(leads, eq(followUps.leadId, leads.id))
    .where(where)
    .orderBy(asc(followUps.dueAt))
    .limit(limit)
    .offset(offset);

  const list: FollowUpWithLead[] = rows.map((r) => ({
    ...r.followUp,
    lead: {
      id: r.leadId,
      name: r.leadName,
      company: r.leadCompany,
      phone: r.leadPhone,
      pipelineStage: r.leadStage,
    },
  }));

  return { followUps: list, total };
}

/** Resolve a follow-up (done or canceled) and timeline it on the lead. */
export async function completeFollowUp(
  id: string,
  opts: { status: "done" | "canceled"; repId?: string },
): Promise<FollowUp> {
  return db.transaction(async (tx) => {
    const [followUp] = await tx
      .update(followUps)
      .set({ status: opts.status, completedAt: new Date() })
      .where(eq(followUps.id, id))
      .returning();
    if (!followUp) throw new Error(`follow-up ${id} not found`);

    const verb = opts.status === "done" ? "completed" : "canceled";
    await tx.insert(leadActivities).values({
      leadId: followUp.leadId,
      repId: opts.repId ?? null,
      kind: "followup",
      body: `Follow-up ${verb}`,
      meta: { followUpId: followUp.id, status: opts.status },
    });

    return followUp;
  });
}

/** Push a pending follow-up's due date out. */
export async function snoozeFollowUp(id: string, dueAt: Date): Promise<FollowUp> {
  const [followUp] = await db
    .update(followUps)
    .set({ dueAt })
    .where(eq(followUps.id, id))
    .returning();
  if (!followUp) throw new Error(`follow-up ${id} not found`);
  return followUp;
}

/**
 * Mark a lead's currently-DUE pending `call` follow-ups as done — invoked when a
 * call completes against the lead (console finalize hook, spec §2). This is the
 * path that authorized the re-dial past the ledger dedupe gate, so it's now
 * spent. Constrained to `dueAt <= now` so a deliberately future-scheduled
 * callback (unrelated to the current call) is preserved rather than silently
 * erased.
 */
export async function completePendingCallFollowUps(
  leadId: string,
): Promise<number> {
  const done = await db
    .update(followUps)
    .set({ status: "done", completedAt: new Date() })
    .where(
      and(
        eq(followUps.leadId, leadId),
        eq(followUps.channel, "call"),
        eq(followUps.status, "pending"),
        lte(followUps.dueAt, new Date()),
      ),
    )
    .returning({ id: followUps.id });
  return done.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

/** Per-stage eligible-lead counts + due-now follow-up count for header badges. */
export async function pipelineSummary(): Promise<{
  stages: Record<PipelineStage, number>;
  dueNow: number;
}> {
  const stageRows = await db
    .select({ stage: leads.pipelineStage, n: count() })
    .from(leads)
    .where(eq(leads.validationStatus, "eligible"))
    .groupBy(leads.pipelineStage);

  const stages = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<
    PipelineStage,
    number
  >;
  for (const r of stageRows) stages[r.stage] = r.n;

  const [{ dueNow } = { dueNow: 0 }] = await db
    .select({ dueNow: count() })
    .from(followUps)
    .where(
      and(eq(followUps.status, "pending"), lte(followUps.dueAt, new Date())),
    );

  return { stages, dueNow };
}
