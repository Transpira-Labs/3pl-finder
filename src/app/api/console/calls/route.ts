import { z } from "zod";
import { after } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { apiGuard } from "@/lib/auth/guards";
import { db } from "@/db";
import { callAttempts, leads } from "@/db/schema";
import {
  logOutcome,
  completePendingCallFollowUps,
} from "@/lib/pipeline/service";
import { recordCalled } from "@/lib/pipeline/ledger";
import { reportingTimezone } from "@/lib/analytics/service";
import { localDay } from "@/lib/analytics/stats";
import { queueAnalyticsDaySync } from "@/lib/analytics/sheet-export";
import { planCallbackRetry } from "@/lib/queue/retry-slots";
import { ensureCallbackCampaign } from "@/lib/campaigns/service";
import {
  OUTCOME_TEMPLATES,
  MAX_CALLBACK_ATTEMPTS,
  RECYCLE_DISPOSITIONS,
  dispositionLabel,
  DISPOSITION_TO_TEMPLATE,
} from "@/lib/config";
import { getConsoleSheetUrl } from "@/lib/settings";
import { appendRows } from "@/lib/sheets-server";
import { durationValue, readableTimestamp, type SheetRow } from "@/lib/sheets";

export const dynamic = "force-dynamic";

type Timeline = { state: string; at: string }[] | null;

/**
 * Legacy pre-bridge time from a predictive-dialer state timeline. Only rows
 * written by the old auto-dialer have a timeline; current calls carry ring time
 * in `holdMs` instead (stamped by /api/voice/status). Kept so old history still
 * renders correctly.
 */
function preBridge(timeline: Timeline): { ringing: number; waiting: number } {
  const out = { ringing: 0, waiting: 0 };
  if (!timeline) return out;
  for (let i = 0; i < timeline.length - 1; i++) {
    const dur = Date.parse(timeline[i + 1].at) - Date.parse(timeline[i].at);
    if (!(dur > 0)) continue;
    const s = timeline[i].state;
    if (s === "RINGING" || s === "DIALING") out.ringing += dur;
    else if (s === "IVR_MENU" || s === "ON_HOLD") out.waiting += dur;
  }
  return out;
}

/** Merge machine-measured time + the rep's breakdown into the six-bucket `acc`. */
function toAcc(
  timeline: Timeline,
  holdMs: number | null,
  rep: Record<string, number> | null,
) {
  const pre = preBridge(timeline);
  const r = rep ?? {};
  return {
    // `holdMs` on a current call is the time between placing the call and the
    // lead answering — that is ringing, not hold. Attributing it to "waiting"
    // put every call's ring time under the wrong bucket in history, the CSV and
    // the synced Sheet. Legacy timeline rows keep their own split.
    ringing: pre.ringing || holdMs || 0,
    waiting: pre.waiting,
    right: r.right || 0,
    wrong: r.wrong || 0,
    voicemail: r.voicemail || 0,
    noanswer: r.noanswer || 0,
  };
}

/** One call_attempts row → the shape the console history renders. */
function toCallRow(c: typeof callAttempts.$inferSelect) {
  return {
    id: c.id,
    startedAt: c.startedAt.getTime(),
    endedAt: (c.endedAt ?? c.startedAt).getTime(),
    acc: toAcc(c.timeline, c.holdMs, c.repBreakdown),
    disposition: c.disposition,
    note: c.repNote,
    synced: c.syncedToSheet,
  };
}

// ── GET: recent calls for a rep (history + stats) ────────────────────────────
export async function GET(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const repId = new URL(request.url).searchParams.get("repId");
  if (!repId) return Response.json({ calls: [] });

  const rows = await db
    .select()
    .from(callAttempts)
    .where(eq(callAttempts.repId, repId))
    .orderBy(desc(callAttempts.startedAt))
    .limit(100);

  return Response.json({ calls: rows.map(toCallRow) });
}

// ── POST: finalize a bridged call or log a manual one ────────────────────────
const bodySchema = z.object({
  callId: z.string().optional(), // dialer call_attempts id, if finalizing
  repId: z.string(),
  leadId: z.string().optional(),
  campaignId: z.string().optional(),
  phone: z.string().optional(),
  repBreakdown: z.record(z.string(), z.number()),
  disposition: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});

export async function POST(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  let saved;
  const existing = b.callId
    ? (await db.select().from(callAttempts).where(eq(callAttempts.id, b.callId)))[0]
    : undefined;

  if (existing) {
    // Bridged call: attach the rep's conversation breakdown to the dialer record.
    [saved] = await db
      .update(callAttempts)
      .set({
        repBreakdown: b.repBreakdown,
        disposition: b.disposition ?? existing.disposition,
        repNote: b.note ?? null,
        endedAt: b.endedAt ? new Date(b.endedAt) : new Date(),
      })
      .where(eq(callAttempts.id, b.callId!))
      .returning();
  } else {
    // Manual call: standalone record (no dialer lead/campaign required).
    [saved] = await db
      .insert(callAttempts)
      .values({
        leadId: b.leadId ?? null,
        campaignId: b.campaignId ?? null,
        phone: b.phone ?? "",
        repId: b.repId,
        source: b.callId ? "dialer" : "manual",
        reachedHuman: (b.repBreakdown.right || 0) > 0,
        repBreakdown: b.repBreakdown,
        disposition: b.disposition ?? null,
        repNote: b.note ?? null,
        startedAt: b.startedAt ? new Date(b.startedAt) : new Date(),
        endedAt: b.endedAt ? new Date(b.endedAt) : new Date(),
      })
      .returning();
  }

  // ── Pipeline integration (design §6) ──────────────────────────────────────
  // Manual console call → record a "called" write in the persistent ledger so
  // the number is never re-dialed accidentally. Dialer calls already record on
  // dial-release (engine.ts).
  if (!existing && b.phone) {
    await recordCalled(b.phone, b.leadId ?? undefined);
  }

  const leadId = b.leadId;
  if (leadId && saved) {
    // A completed call satisfies any pending call follow-up for this lead. Do
    // this BEFORE logOutcome so a new callback follow-up it may create is not
    // itself immediately marked done.
    await completePendingCallFollowUps(leadId);

    // Map the rep disposition → outcome template and log it to the lead timeline.
    const disp = b.disposition ?? null;
    const templateKey = disp ? DISPOSITION_TO_TEMPLATE[disp] : undefined;
    const template = templateKey
      ? OUTCOME_TEMPLATES.find((t) => t.key === templateKey)
      : undefined;
    const note = b.note?.trim();
    const body = note || template?.body || "Call logged from console.";
    // Dispositions that re-queue the lead by scheduling a `call` follow-up — the
    // only re-dial path the compliance gate honours once a number has been called.
    //  - callback: the lead asked, so +24h flat, in place.
    //  - voicemail / no_contact (RECYCLE_DISPOSITIONS): the lead went to voicemail
    //    or didn't pick up. Move it into the rolling Callbacks campaign, then
    //    schedule a retry in a different time-of-day slot on a later day (also the
    //    cooldown), up to MAX_CALLBACK_ATTEMPTS. Moving the lead FIRST means the
    //    follow-up and its slot are derived from the Callbacks campaign's window,
    //    and the lead only gets dialed again once that campaign has reps assigned
    //    — which is the "run the callbacks later" switch. Past the cap the plan
    //    comes back `retire` and the lead is closed out below instead.
    const isRecycle = disp
      ? (RECYCLE_DISPOSITIONS as readonly string[]).includes(disp)
      : false;
    let plan = null as Awaited<ReturnType<typeof planCallbackRetry>> | null;
    if (isRecycle) {
      const callbackCampaign = await ensureCallbackCampaign();
      if (callbackCampaign) {
        await db
          .update(leads)
          .set({ campaignId: callbackCampaign.id })
          .where(eq(leads.id, leadId));
      }
      plan = await planCallbackRetry(leadId);
    }
    const followUp =
      disp === "callback"
        ? {
            channel: "call" as const,
            dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            note: "Callback requested from console",
          }
        : (plan?.followUp ?? undefined);

    // Out of attempts: close the lead. Leaving it `eligible` would be safe (the
    // gate denies it) but wasteful — claimNext would keep picking it up and
    // burning the 25-candidate walk budget on a lead nobody can call. `lost` and
    // not `do_not_contact`: the prospect never asked to be left alone, and that
    // stage is the compliance/opt-out vocabulary.
    const stage = plan?.retire ? ("lost" as const) : undefined;

    await logOutcome(leadId, {
      templateKey: template?.key,
      // Keep whatever the rep typed; the retirement note is appended, not
      // substituted, so their last word on the lead isn't thrown away.
      body: plan?.retire
        ? `${note ? `${note} — ` : ""}No answer after ${MAX_CALLBACK_ATTEMPTS} attempts, retiring this lead.`
        : body,
      stage,
      repId: b.repId,
      callAttemptId: saved.id,
      followUp,
    });
  }

  // Auto-log to the admin-configured call-log Google Sheet (Settings →
  // Connections). Runs AFTER the response: it's two round trips to Google that
  // the rep would otherwise sit through with the disposition dialog still open.
  // It can't fail the call save — the DB write above is the durable record — and
  // it's idempotent (appendRows de-dupes by id, syncedToSheet stops a
  // re-append), so deferring costs nothing and makes saving feel instant.
  if (saved) {
    const row = saved;
    after(async () => {
      // Two independent try/catches: a broken Calls tab must not cost us the
      // analytics refresh, and vice versa.
      if (!row.syncedToSheet) {
        try {
          const sheetUrl = await getConsoleSheetUrl();
          if (!sheetUrl) return;
          await appendRows(sheetUrl, [callAttemptToRow(row)]);
          await db
            .update(callAttempts)
            .set({ syncedToSheet: true })
            .where(eq(callAttempts.id, row.id));
        } catch (e) {
          console.error("[console/calls] call-log sheet append failed:", e);
        }
      }

      // Keep the day's row in the running Analytics tab current. The day comes
      // from the call's own start time in the reporting timezone — an 11:58pm
      // call belongs to the day it started, not to whenever this deferred task
      // happens to run.
      try {
        const tz = await reportingTimezone();
        await queueAnalyticsDaySync(localDay(row.startedAt, tz));
      } catch (e) {
        console.error("[console/calls] analytics sheet upsert failed:", e);
      }
    });
  }

  // Return the saved row in history shape so the console can show it
  // immediately instead of waiting on a follow-up GET.
  return Response.json({
    ok: true,
    id: saved?.id,
    call: saved ? toCallRow(saved) : null,
  });
}

// ── PATCH: mark rows synced to the Google Sheet ──────────────────────────────
const patchSchema = z.object({ ids: z.array(z.string()).min(1) });

export async function PATCH(request: Request) {
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  await db
    .update(callAttempts)
    .set({ syncedToSheet: true })
    .where(inArray(callAttempts.id, parsed.data.ids));
  return Response.json({ ok: true, updated: parsed.data.ids.length });
}

// ── DELETE: remove one manual call by id, or clear a rep's manual history ─────
// Scoped to source='manual' so a rep clearing their console history can never
// destroy authoritative dialer-bridged records (they are dialer-owned and are
// referenced by dashboard metrics + lead_activities.call_attempt_id).
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const repId = url.searchParams.get("repId");
  if (id) {
    await db
      .delete(callAttempts)
      .where(and(eq(callAttempts.id, id), eq(callAttempts.source, "manual")));
    return Response.json({ ok: true });
  }
  if (repId) {
    await db
      .delete(callAttempts)
      .where(
        and(eq(callAttempts.repId, repId), eq(callAttempts.source, "manual")),
      );
    return Response.json({ ok: true });
  }
  return Response.json({ error: "id or repId required" }, { status: 400 });
}

/**
 * Turn a saved call_attempts row into the shared 12-column SheetRow (same shape
 * the solo/localStorage path writes via callToRow, so both modes land identical
 * rows in the one "Calls" tab). Durations are written as day-fractions so the
 * Sheet renders them as readable elapsed time and still sums; total is wall-clock
 * start→end — the real call duration — to match the client's callToRow.
 */
function callAttemptToRow(c: typeof callAttempts.$inferSelect): SheetRow {
  const acc = toAcc(c.timeline, c.holdMs, c.repBreakdown);
  const ended = c.endedAt ?? c.startedAt;
  const row: SheetRow = {
    id: c.id,
    started: readableTimestamp(c.startedAt),
    ended: readableTimestamp(ended),
    ringing: durationValue(acc.ringing),
    waiting: durationValue(acc.waiting),
    right: durationValue(acc.right),
    wrong: durationValue(acc.wrong),
    voicemail: durationValue(acc.voicemail),
    noanswer: durationValue(acc.noanswer),
    total: durationValue(ended.getTime() - c.startedAt.getTime()),
    disposition: dispositionLabel(c.disposition),
    note: c.repNote ?? "",
  };
  return row;
}
