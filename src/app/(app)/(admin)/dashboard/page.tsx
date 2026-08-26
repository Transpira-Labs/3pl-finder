"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Phone, Users, PhoneCall, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Calling dashboard (admin view).
 *
 * Reps place every call themselves from /console, so this page reports rather
 * than drives: how big the queue is, who's on the phone right now, what the
 * calls produced, and what Twilio is costing. There is no "start dialing"
 * control — nothing dials without a rep clicking Call.
 */

type Campaign = { id: string; name: string };
type Rep = {
  id: string;
  name: string;
  phone: string | null;
  presence: "available" | "away";
  onCall: boolean;
};
/** A platform user who can take calls — role `rep` or `admin`. */
type CallableUser = {
  userId: string;
  email: string;
  name: string | null;
  role: "rep" | "admin";
  repId: string | null;
  presence: "available" | "away" | null;
  onCall: boolean;
  campaignIds: string[];
};
type Metrics = {
  windowMinutes: number;
  calls: number;
  callsPerHour: number;
  connected: number;
  connectRate: number;
  avgCallMs: number;
  totalTalkMs: number;
  activeReps: number;
};
type CallRow = {
  id: string;
  phone: string;
  disposition: string | null;
  reachedHuman: boolean;
  startedAt: string;
  endedAt: string | null;
};
type LeadRow = {
  id: string;
  phone: string | null;
  name: string | null;
  company: string | null;
  timezone: string | null;
  attempted: boolean;
  reachedHuman: boolean;
  disposition: string | null;
  attemptedAt: string | null;
};
type Snapshot = {
  campaign: Campaign;
  reps: Rep[];
  idleReps: number;
  queueDepth: number;
  calledCount: number;
  remainingCount: number;
  metrics: Metrics;
  dispositions: Record<string, number>;
  calls: CallRow[];
  leads: LeadRow[];
};
type TwilioCost = {
  configured: boolean;
  currency?: string;
  balance?: number | null;
  totalSpent?: number;
  voiceSpent?: number;
  voiceCount?: number;
  clientSpent?: number;
  clientCount?: number;
  error?: string;
};

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

const DISPOSITION_LABELS: Record<string, string> = {
  booked: "Meeting booked",
  callback: "Callback",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  no_contact: "No contact",
  other: "Other",
  none: "Not dispositioned",
};

export default function Dashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [cost, setCost] = useState<TwilioCost | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [callable, setCallable] = useState<CallableUser[]>([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const snapSeq = useRef(0); // newest request wins
  const snapInFlight = useRef(false); // don't stack polls

  // Twilio cost — polled slowly (usage lags; balance is the live signal).
  useEffect(() => {
    const load = () =>
      fetch("/api/telephony/cost")
        .then((x) => x.json())
        .then(setCost)
        .catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const loadCampaigns = useCallback(async () => {
    const r = await fetch("/api/campaigns")
      .then((x) => x.json())
      .catch(() => ({}));
    // Defensive: an expired session returns {error} with no array, and
    // setCampaigns(undefined) would blank the whole dashboard on the next render.
    const list: Campaign[] = Array.isArray(r.campaigns) ? r.campaigns : [];
    setCampaigns(list);
    if (!selected && list[0]) setSelected(list[0].id);
    return list;
  }, [selected]);

  /**
   * Fetch the campaign snapshot.
   *
   * The endpoint fans out into six queries, and a cold Supabase connection makes
   * the first one take seconds — longer than the 5s poll interval, so requests
   * can overlap. Three guards, in order of how badly each bit:
   *  - `inFlight` stops a slow request from stacking behind itself.
   *  - `seq` drops a stale response that lands after a newer one, which would
   *    otherwise show the previous campaign's numbers.
   *  - failures are surfaced. This previously read `if (!r.error) setSnap(r)`
   *    with no catch at all, so a timeout left `snap` null forever and the page
   *    silently fell back to the getting-started copy.
   */
  const loadSnap = useCallback(
    async (signal?: AbortSignal) => {
      if (!selected || snapInFlight.current) return;
      snapInFlight.current = true;
      const seq = ++snapSeq.current;
      setSnapLoading(true);
      try {
        const res = await fetch(`/api/campaigns/${selected}`, { signal });
        const r = await res.json().catch(() => ({}));
        if (seq !== snapSeq.current) return; // superseded
        if (!res.ok || r.error) {
          setSnapError(
            res.status === 401 || res.status === 403
              ? "Your session expired — sign in again."
              : (r.error ?? `Couldn't load the campaign (HTTP ${res.status}).`),
          );
          return;
        }
        setSnap(r);
        setSnapError(null);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        if (seq === snapSeq.current) setSnapError("Couldn't reach the server.");
      } finally {
        snapInFlight.current = false;
        if (seq === snapSeq.current) setSnapLoading(false);
      }
    },
    [selected],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCampaigns();
  }, [loadCampaigns]);

  // Poll for the live view. Reps drive the calls, so a few seconds of lag on an
  // admin's read-only board is fine — no event stream needed.
  useEffect(() => {
    if (!selected) return;
    // Clear the previous campaign's numbers immediately, so switching shows a
    // loading state rather than the old campaign's data wearing the new name.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSnap(null);
    setSnapError(null);
    snapInFlight.current = false;
    const ac = new AbortController();
    void loadSnap(ac.signal);
    const poll = setInterval(() => void loadSnap(), 5000);
    return () => {
      ac.abort();
      clearInterval(poll);
    };
  }, [selected, loadSnap]);

  /**
   * Create a campaign from the inline form.
   *
   * This used to call `prompt()`. Browsers permanently suppress dialogs on a page
   * once the user ticks "prevent this page from creating additional dialogs", and
   * a suppressed prompt returns null — so the button silently did nothing with no
   * way to tell it had failed. Everything here is in-page for that reason, and a
   * failed request reports itself instead of throwing on `r.campaign.id`.
   */
  async function createCampaign() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.campaign?.id) {
        setMsg({
          kind: "err",
          text:
            res.status === 401 || res.status === 403
              ? "Your session expired, or this account isn't an admin. Sign in again."
              : (r.error ?? `Couldn't create the campaign (HTTP ${res.status}).`),
        });
        return;
      }
      setNewName("");
      await loadCampaigns();
      setSelected(r.campaign.id);
      setMsg({ kind: "ok", text: `Created “${r.campaign.name}”.` });
    } catch {
      setMsg({ kind: "err", text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  async function assignLeads() {
    if (!selected || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/campaigns/${selected}/assign-leads`, {
        method: "POST",
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: r.error ?? `Couldn't assign leads (HTTP ${res.status}).` });
        return;
      }
      setMsg(
        r.assigned > 0
          ? { kind: "ok", text: `Assigned ${r.assigned} eligible leads to the calling queue.` }
          : {
              kind: "err",
              text: "No unassigned eligible leads to add. Import some on the Leads page first.",
            },
      );
      loadSnap();
    } catch {
      setMsg({ kind: "err", text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  /** Everyone on the platform who can take calls (role rep or admin). */
  useEffect(() => {
    if (!selected) return;
    let active = true;
    (async () => {
      const r = await fetch(`/api/campaigns/${selected}/reps`).then((x) => x.json());
      if (active) setCallable(Array.isArray(r.users) ? r.users : []);
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [selected]);

  /**
   * Empty the unworked queue so a fresh list can be assigned in. Confirmed with
   * the split that actually matters: what goes, and what is deliberately kept.
   */
  async function clearQueue() {
    if (!selected || busy) return;
    const c = campaigns.find((x) => x.id === selected);
    const worked = snap?.calledCount ?? 0;
    const remaining = snap?.remainingCount ?? 0;
    const ok = window.confirm(
      `Clear the queue on “${c?.name ?? "this campaign"}”?\n\n` +
        `About ${remaining} uncalled lead${remaining === 1 ? "" : "s"} will be deleted so you can assign a fresh list.\n\n` +
        `Kept: ${worked} lead${worked === 1 ? "" : "s"} that were already called, their call history, ` +
        `and every number in the contact ledger that was dialed — those stay blocked from being called again.\n` +
        `Uncalled numbers are released from the ledger, so they can be re-imported later.`,
    );
    if (!ok) return;

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/campaigns/${selected}/clear-queue`, {
        method: "POST",
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: r.error ?? `Couldn't clear (HTTP ${res.status}).` });
        return;
      }
      setMsg({
        kind: "ok",
        text:
          `Cleared ${r.deleted} uncalled lead${r.deleted === 1 ? "" : "s"} from “${r.name}”. ` +
          `Kept ${r.keptWorked} already-called${r.keptClaimed ? ` and ${r.keptClaimed} in progress` : ""}. ` +
          `${r.ledgerReleased} number${r.ledgerReleased === 1 ? "" : "s"} released for re-import.`,
      });
      loadSnap();
    } catch {
      setMsg({ kind: "err", text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Delete the selected campaign. Confirmed inline with the real consequence —
   * how many leads get unassigned — rather than a generic "are you sure", since
   * the lead count is the part someone would regret not knowing.
   */
  async function removeCampaign() {
    if (!selected || busy) return;
    const c = campaigns.find((x) => x.id === selected);
    const leadCount = snap?.leads?.length ?? 0;
    const ok = window.confirm(
      `Delete “${c?.name ?? "this campaign"}”?\n\n` +
        `${leadCount} lead${leadCount === 1 ? "" : "s"} will be unassigned and returned to the pool — ` +
        `they are not deleted, and can be assigned to another campaign.\n` +
        `Rep assignments for this campaign are removed. Call history is kept.`,
    );
    if (!ok) return;

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/campaigns/${selected}`, { method: "DELETE" });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: r.error ?? `Couldn't delete (HTTP ${res.status}).` });
        return;
      }
      setMsg({
        kind: "ok",
        text:
          `Deleted “${r.name}”. ${r.leadsUnassigned} lead${r.leadsUnassigned === 1 ? "" : "s"} ` +
          `returned to the pool, ${r.repsUnassigned} rep assignment${r.repsUnassigned === 1 ? "" : "s"} removed.`,
      });
      setSnap(null);
      setSelected(null);
      const list = await loadCampaigns();
      setSelected(list[0]?.id ?? null);
    } catch {
      setMsg({ kind: "err", text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  /** Add or remove this user from the selected campaign. */
  async function toggleAssignment(u: CallableUser, assigned: boolean) {
    if (!selected || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/campaigns/${selected}/reps`, {
        method: assigned ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.userId }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: r.error ?? `Failed (HTTP ${res.status}).` });
        return;
      }
      if (Array.isArray(r.users)) setCallable(r.users);
      setMsg({
        kind: "ok",
        text: `${u.name ?? u.email} ${assigned ? "removed from" : "added to"} this campaign.`,
      });
      loadSnap();
    } catch {
      setMsg({ kind: "err", text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  async function togglePresence(rep: Rep) {
    if (!selected) return;
    await fetch(`/api/campaigns/${selected}/reps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repId: rep.id,
        presence: rep.presence === "available" ? "away" : "available",
      }),
    });
    loadSnap();
  }

  const onCallReps = snap?.reps.filter((r) => r.onCall) ?? [];

  return (
    <main className="mx-auto max-w-6xl px-5 py-6">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
            <PhoneCall className="h-4 w-4" />
          </div>
          <h1 className="text-lg font-semibold">Calling Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-foreground"
          >
            {campaigns.length === 0 && <option value="">No campaigns</option>}
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createCampaign();
            }}
            placeholder="New campaign name"
            className="w-44 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Btn onClick={createCampaign}>{busy ? "Working…" : "+ Campaign"}</Btn>
          <Btn onClick={assignLeads}>Assign leads</Btn>
          {selected && (
            <button
              onClick={clearQueue}
              disabled={busy}
              title="Delete the uncalled leads so a fresh list can be assigned. Called leads, call history, and dialed numbers in the contact ledger are kept."
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Clear queue
            </button>
          )}
          {selected && (
            <button
              onClick={removeCampaign}
              disabled={busy}
              title="Delete this campaign. Its leads are unassigned, not deleted."
              className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              Delete campaign
            </button>
          )}
          <Link
            href="/console"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Open call console
          </Link>
        </div>
      </div>

      {msg && (
        <p
          className={cn(
            "mt-3 text-sm",
            msg.kind === "ok" ? "text-emerald-600" : "text-destructive",
          )}
        >
          {msg.text}
        </p>
      )}

      {/* Reps on this campaign. Everyone with role rep or admin is a rep — there
          is no "create a rep" step, so this is purely who works this campaign.
          A rep can be on several campaigns and draws leads from all of them. */}
      {selected && (
        <section className="mt-6 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Reps on this campaign</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Anyone who signs up and is given the <b>rep</b> or <b>admin</b> role appears
            here. A rep sees leads only from the campaigns they are assigned to — until
            you assign one, their console stays empty.
          </p>

          {callable.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No one has the rep or admin role yet. Invite teammates to sign up, then
              promote them under{" "}
              <Link className="underline" href="/settings">
                Settings → Team
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {callable.map((u) => {
                const assigned = u.campaignIds.includes(selected);
                const others = u.campaignIds.filter((c) => c !== selected).length;
                return (
                  <li key={u.userId} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {u.name ?? u.email}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          {u.role}
                        </span>
                        {u.onCall && (
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600">
                            on a call
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {u.email}
                        {!u.repId && " · hasn't opened the console yet"}
                        {others > 0 && ` · also on ${others} other campaign${others > 1 ? "s" : ""}`}
                      </div>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => void toggleAssignment(u, assigned)}
                      className={cn(
                        "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                        assigned
                          ? "border border-border text-muted-foreground hover:bg-accent"
                          : "bg-primary text-primary-foreground hover:opacity-90",
                      )}
                    >
                      {assigned ? "Remove" : "Assign"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* A cold snapshot can take seconds. Showing the getting-started copy
          while it loads made a working campaign look like it had vanished, so
          loading, failed and genuinely-empty are now three distinct states. */}
      {!snap && snapLoading && (
        <p className="mt-8 text-sm text-muted-foreground">Loading campaign…</p>
      )}

      {!snap && !snapLoading && snapError && (
        <p className="mt-8 text-sm text-destructive">
          {snapError}{" "}
          <button className="underline" onClick={() => void loadSnap()}>
            Retry
          </button>
        </p>
      )}

      {/* The snapshot loaded before, but the latest refresh failed — keep the
          numbers on screen and say they're stale rather than blanking them. */}
      {snap && snapError && (
        <p className="mt-3 text-xs text-muted-foreground">
          Live updates paused — {snapError}{" "}
          <button className="underline" onClick={() => void loadSnap()}>
            Retry
          </button>
        </p>
      )}

      {!snap && !snapLoading && !snapError && (
        <p className="mt-8 text-sm text-muted-foreground">
          Create a campaign, assign eligible leads (import some on the{" "}
          <Link className="underline" href="/">ingestion page</Link> first), add a
          rep, then open the console — reps pull leads from the queue and call
          them themselves.
        </p>
      )}

      {snap && (
        <>
          {/* Who's on the phone right now */}
          <div
            className={cn(
              "mt-4 flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium",
              onCallReps.length > 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                onCallReps.length > 0
                  ? "animate-pulse bg-emerald-500"
                  : "bg-muted-foreground/40",
              )}
            />
            {onCallReps.length > 0
              ? `${onCallReps.length} rep${onCallReps.length > 1 ? "s" : ""} on a call — ${onCallReps.map((r) => r.name).join(", ")}`
              : `No calls in progress. ${snap.idleReps} rep${snap.idleReps === 1 ? "" : "s"} available.`}
          </div>

          {/* Metric tiles */}
          <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Leads left to call" value={snap.remainingCount} accent />
            <Tile label="Called" value={snap.calledCount} />
            <Tile label="Reps available" value={snap.idleReps} />
            <Tile label={`Calls (last ${snap.metrics.windowMinutes}m)`} value={snap.metrics.calls} />
            <Tile label="Connect rate" value={pct(snap.metrics.connectRate)} />
            <Tile label="Avg call" value={duration(snap.metrics.avgCallMs)} />
          </section>

          <CostBar cost={cost} />

          <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* OUTCOMES */}
            <div>
              <SectionHead icon={PhoneCall}>Outcomes (last 24h)</SectionHead>
              <div className="space-y-1.5">
                {Object.keys(snap.dispositions).length === 0 && (
                  <Empty>No calls logged in the last 24 hours.</Empty>
                )}
                {Object.entries(snap.dispositions)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, n]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    >
                      <span>{DISPOSITION_LABELS[key] ?? key}</span>
                      <span className="font-mono tabular-nums">{n}</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* LEADS QUEUE */}
            <div>
              <SectionHead icon={Phone}>
                Leads
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {snap.remainingCount} left · {snap.calledCount} called · {snap.leads.length} total
                </span>
              </SectionHead>
              <div className="max-h-[420px] space-y-1.5 overflow-auto">
                {snap.leads.length === 0 && (
                  <Empty>No leads assigned. Import on the ingestion page, then “Assign leads.”</Empty>
                )}
                {snap.leads.map((l) => {
                  const badge = l.attempted
                    ? l.reachedHuman
                      ? { label: l.disposition ?? "connected", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" }
                      : { label: l.disposition ?? "called", cls: "bg-slate-100 text-slate-600 border-slate-200" }
                    : { label: "queued", cls: "bg-slate-100 text-slate-500 border-slate-200" };
                  return (
                    <div
                      key={l.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-sm">{l.phone ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {l.name ?? "Unknown"}{l.company ? ` · ${l.company}` : ""}
                        </div>
                      </div>
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", badge.cls)}>
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Reps */}
          <section className="mt-5">
            <SectionHead icon={Users}>Reps</SectionHead>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {snap.reps.length === 0 && <Empty>No reps yet — add one, or have a rep sign in and open the console.</Empty>}
              {snap.reps.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {r.phone ?? "browser softphone"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.onCall && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">on call</span>
                    )}
                    <button
                      onClick={() => togglePresence(r)}
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        r.presence === "available" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {r.presence}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Recent completed calls */}
          <section className="mt-5">
            <SectionHead icon={PhoneCall}>Recent calls</SectionHead>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Connected</th>
                    <th className="px-3 py-2">Disposition</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.calls.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No completed calls yet.</td></tr>
                  )}
                  {snap.calls.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{c.phone}</td>
                      <td className="px-3 py-2 text-xs">{c.reachedHuman ? "yes" : "no"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {c.disposition ? (DISPOSITION_LABELS[c.disposition] ?? c.disposition) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {c.endedAt
                          ? duration(Date.parse(c.endedAt) - Date.parse(c.startedAt))
                          : "in progress"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(c.startedAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function CostBar({ cost }: { cost: TwilioCost | null }) {
  if (!cost) return null;
  if (!cost.configured) {
    return (
      <div className="mt-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
        Twilio cost unavailable — Twilio credentials are not configured.
      </div>
    );
  }
  const cur = cost.currency ?? "USD";
  const money = (n: number | null | undefined) =>
    n == null ? "—" : `$${n.toFixed(2)}`;
  const money4 = (n: number | null | undefined) =>
    n == null ? "—" : `$${n.toFixed(4)}`;

  return (
    <section className="mt-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <DollarSign className="h-4 w-4 text-muted-foreground" />
        Twilio cost
        <span className="text-xs font-normal text-muted-foreground">({cur} · usage lags a few min, balance is live)</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-xl font-semibold tabular-nums text-emerald-700">{money(cost.balance)}</div>
          <div className="text-xs text-emerald-700/80">Balance remaining</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xl font-semibold tabular-nums">{money4(cost.totalSpent)}</div>
          <div className="text-xs text-muted-foreground">Total spent (all-time)</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xl font-semibold tabular-nums">{money4(cost.voiceSpent)}</div>
          <div className="text-xs text-muted-foreground">Outbound voice · {cost.voiceCount ?? 0} calls</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xl font-semibold tabular-nums">{money4(cost.clientSpent)}</div>
          <div className="text-xs text-muted-foreground">Softphone legs · {cost.clientCount ?? 0}</div>
        </div>
      </div>
    </section>
  );
}

function Btn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        primary ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border text-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function Tile({ label, value, danger, accent }: { label: string; value: string | number; danger?: boolean; accent?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", danger ? "border-red-200 bg-red-50" : "border-border bg-card")}>
      <div className={cn("text-xl font-semibold tabular-nums", danger ? "text-red-700" : accent ? "text-primary" : "")}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function SectionHead({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
      <Icon className="h-4 w-4 text-muted-foreground" />
      {children}
    </h2>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
