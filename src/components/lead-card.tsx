"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCheck,
  ExternalLink,
  Globe,
  Layers,
  Mail,
  Phone,
  RefreshCw,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTracker } from "@/components/tracker-provider";
import { useSoftphone } from "@/components/softphone";

/**
 * The rep's lead card — the whole dialer, from their side.
 *
 * One lead at a time, claimed to this rep so nobody else is handed the same
 * prospect. The rep reads the context, then either calls it or skips it. Nothing
 * dials on its own: pressing Call authorizes the attempt server-side
 * (/api/queue/call-start, which runs the compliance gate) and connects the
 * softphone with the returned attempt id — never with a phone number.
 */

type QueueLead = {
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

type RepCampaign = { id: string; name: string; waiting: number };

/** Remembers the rep's campaign across reloads. Per-browser, not per-account. */
const CAMPAIGN_KEY = "console.campaignId";

/** Make a bare domain from a lead list clickable without mangling a full URL. */
function href(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

export function LeadCard() {
  const t = useTracker();
  const phone = useSoftphone();

  const [lead, setLead] = useState<QueueLead | null>(null);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialing, setDialing] = useState(false);
  // Set when a call finishes: the card holds on the lead just worked until the
  // rep explicitly advances.
  const [awaitingNext, setAwaitingNext] = useState(false);

  // Editable contact email — a rep often gets it verbally mid-call, and it's what
  // an email follow-up needs. Draft is local; saved to the lead on blur/Enter.
  const [emailDraft, setEmailDraft] = useState("");
  const [emailStatus, setEmailStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  // Arms the "already called" confirm. Cleared whenever a new card arrives, so a
  // half-pressed confirm can never carry over onto the next lead.
  const [confirmSeen, setConfirmSeen] = useState(false);

  // True while the card holds a lead the rep picked by name from the pipeline
  // (/console?lead=<id>) rather than one the queue served.
  const [direct, setDirect] = useState(false);

  const nextRef = useRef<HTMLButtonElement>(null);

  // The pipeline's "call this lead" jump. Read once and consumed once: after
  // the claim the param is stripped from the URL, so a reload or "Next lead"
  // falls back to the normal serve.
  const directRef = useRef<string | null>(
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("lead"),
  );

  // Which campaign the rep is working; null means all of theirs. Read straight
  // out of storage rather than in an effect, so the very first serve already
  // carries it and a reload can't fetch from the wrong campaign and then swap
  // the card out. Nothing renders it on the first paint — the picker needs the
  // fetched list — so the server and client agree on that render.
  const [campaigns, setCampaigns] = useState<RepCampaign[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : localStorage.getItem(CAMPAIGN_KEY) || null,
  );

  useEffect(() => {
    let active = true;
    void fetch("/api/queue/campaigns")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const list: RepCampaign[] = d.campaigns ?? [];
        setCampaigns(list);
        // Drop a saved campaign the rep is no longer assigned to, rather than
        // letting every serve come back "not assigned to that campaign".
        const saved = localStorage.getItem(CAMPAIGN_KEY);
        if (saved && !list.some((c) => c.id === saved)) {
          localStorage.removeItem(CAMPAIGN_KEY);
          setCampaignId(null);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const pickCampaign = useCallback((id: string | null) => {
    if (id) localStorage.setItem(CAMPAIGN_KEY, id);
    else localStorage.removeItem(CAMPAIGN_KEY);
    setCampaignId(id);
  }, []);

  const apply = useCallback(
    (data: { lead?: QueueLead | null; reason?: string }) => {
      setLead(data.lead ?? null);
      setEmptyReason(data.lead ? null : (data.reason ?? "No leads available."));
      setAwaitingNext(false); // a fresh card is never in the "just called" state
      setConfirmSeen(false);
      setDirect(false);
    },
    [],
  );

  const fetchNext = useCallback(
    async (path: "next" | "skip" | "mark-contacted", body?: object) => {
      setLoading(true);
      setError("");
      try {
        const r = await fetch(`/api/queue/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Every serve carries the campaign, including the ones that follow a
          // skip or an "already called" — otherwise finishing a lead would drop
          // the rep back into the unfiltered pool.
          body: JSON.stringify({ ...(body ?? {}), campaignId: campaignId ?? null }),
        }).then((x) => x.json());
        if (r.error) setError(r.error);
        else apply(r);
      } catch {
        setError("Couldn't reach the lead queue.");
      } finally {
        setLoading(false);
      }
    },
    [apply, campaignId],
  );

  /**
   * Claim the specific lead the rep jumped here for. The server side
   * (/api/queue/claim) keeps every rule the queue enforces — campaign
   * assignment, single-claim, the compliance gate — so this only changes *which*
   * lead lands on the card, never what may be dialed.
   */
  const claimDirect = useCallback(
    async (leadId: string) => {
      setLoading(true);
      setError("");
      try {
        const r = await fetch("/api/queue/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId }),
        }).then((x) => x.json());
        if (r.error) {
          setLead(null);
          setEmptyReason("Couldn't pull up that lead — check again to work the queue.");
          setError(r.reason ? `${r.error}: ${r.reason}` : r.error);
        } else {
          apply(r);
          setDirect(true);
        }
      } catch {
        setError("Couldn't reach the lead queue.");
      } finally {
        setLoading(false);
      }
    },
    [apply],
  );

  // Pull the first card once the saved campaign is known, and again whenever the
  // rep switches — switching is a request for a lead from the new campaign, and
  // serveNext releases any claim held outside it. After that the rep drives the
  // pace: finishing a call parks the deck on a "saved" panel until they hit
  // Next, so cards can't flick past between calls. A direct jump from the
  // pipeline takes the first serve's place instead.
  useEffect(() => {
    const directId = directRef.current;
    if (directId) {
      directRef.current = null;
      window.history.replaceState(null, "", window.location.pathname);
      void claimDirect(directId);
      return;
    }
    fetchNext("next");
  }, [fetchNext, claimDirect]);

  // The tracker clears `incoming` once the rep dispositions the call. That
  // transition — not a re-render — is the cue that a call just finished.
  const inCallId = t.incoming?.callId ?? null;
  const prevCallId = useRef<string | null>(null);
  useEffect(() => {
    const had = prevCallId.current;
    prevCallId.current = inCallId;
    if (had && !inCallId) setAwaitingNext(true);
  }, [inCallId]);

  // Advance to the next lead. The just-called lead won't come back: the contact
  // ledger makes the gate deny it, so serveNext releases the claim and moves on
  // (unless a voicemail retry scheduled it for a later slot).
  const advance = useCallback(() => {
    setAwaitingNext(false);
    void fetchNext("next");
  }, [fetchNext]);

  // Focus the button as soon as the deck parks. Two reasons: the rep's hands stay
  // on the keyboard, and the tracker's global handler deliberately bails when the
  // event target is a BUTTON — so a focused Next button makes plain Enter activate
  // it natively instead of being swallowed by `openEndCall`. Radix also restores
  // focus to the dialog's trigger on close, which would otherwise eat the key.
  useEffect(() => {
    if (awaitingNext) nextRef.current?.focus();
  }, [awaitingNext]);

  // `N` advances, but only while the deck is parked — so it can never fire
  // mid-call or fight the tracker's own 1-6 / Space / Enter bindings.
  useEffect(() => {
    if (!awaitingNext) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [awaitingNext, advance]);

  // Keep the email draft in sync with whichever lead is served. Keyed on lead id
  // only — syncing on the email itself would clobber what the rep is typing.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setEmailDraft(lead?.email ?? "");
    setEmailStatus("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const saveEmail = useCallback(async () => {
    if (!lead) return;
    const next = emailDraft.trim();
    if (next === (lead.email ?? "")) return; // nothing changed
    setEmailStatus("saving");
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: next }),
      });
      if (!res.ok) {
        setEmailStatus("error");
        return;
      }
      setLead((prev) => (prev ? { ...prev, email: next || null } : prev));
      setEmailStatus("saved");
    } catch {
      setEmailStatus("error");
    }
  }, [lead, emailDraft]);

  // While a call is running the card stays pinned to that lead — pulling the
  // next one mid-conversation would drop the rep's context.
  const busy = t.incoming != null || phone.onCall;

  async function call() {
    if (!lead || dialing) return;
    setDialing(true);
    setError("");
    try {
      const r = await fetch("/api/queue/call-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      }).then((x) => x.json());

      if (r.error) {
        setError(r.reason ? `${r.error}: ${r.reason}` : r.error);
        return;
      }

      try {
        await phone.dial(r.attemptId);
      } catch (e) {
        // The call was authorized but the softphone couldn't connect — close the
        // attempt so the rep isn't left flagged on-call with a dangling row.
        void fetch("/api/queue/call-abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: r.attemptId }),
        }).catch(() => {});
        throw e;
      }

      // Pin the lead onto the stopwatch and start it on "right party".
      t.startIncoming({
        callId: r.attemptId,
        leadId: lead.id,
        campaignId: lead.campaignId,
        phone: lead.phone,
        name: lead.name,
        company: lead.company,
        note: lead.notes,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the call.");
    } finally {
      setDialing(false);
    }
  }

  // The picker sits above every state of the card, including the empty one —
  // "this campaign is done, switch to another" is exactly when a rep needs it.
  const frame = (body: React.ReactNode) => (
    <div className="space-y-2">
      <CampaignPicker
        campaigns={campaigns}
        value={campaignId}
        onChange={pickCampaign}
        disabled={loading || dialing || !!t.incoming}
      />
      {body}
    </div>
  );

  if (loading && !lead) {
    return frame(
      <Shell>
        <p className="text-sm text-muted-foreground">Finding your next lead…</p>
      </Shell>,
    );
  }

  if (!lead) {
    return frame(
      <Shell>
        <p className="text-sm text-muted-foreground">{emptyReason}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 gap-1.5"
          onClick={() => fetchNext("next")}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Check again
        </Button>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </Shell>,
    );
  }

  return frame(
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {awaitingNext ? "Just called" : direct ? "Direct call" : "Next lead"}
          </div>
          <div className="mt-1 truncate text-lg font-semibold">
            {lead.name ?? lead.company ?? "Unknown contact"}
          </div>
          {lead.company && lead.name && (
            <div className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              {lead.company}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm font-medium">{lead.phone}</div>
          {lead.localTime && (
            <div className="text-xs text-muted-foreground">
              {lead.localTime} their time
            </div>
          )}
        </div>
      </div>

      {lead.website && (
        <a
          href={href(lead.website)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Globe className="h-3.5 w-3.5" />
          {lead.website}
          <ExternalLink className="h-3 w-3 opacity-60" />
        </a>
      )}

      {/* Editable contact email — capture it mid-call so an email follow-up can
          reach them. Saves on blur or Enter. */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            type="email"
            value={emailDraft}
            onChange={(e) => {
              setEmailDraft(e.target.value);
              setEmailStatus("idle");
            }}
            onBlur={saveEmail}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Add email for follow-up…"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground">
            {emailStatus === "saving" && "Saving…"}
            {emailStatus === "saved" && (
              <span className="inline-flex items-center gap-0.5 text-emerald-600">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
            {emailStatus === "error" && <span className="text-red-600">Error</span>}
          </span>
        </div>
        {lead.source && (
          <div className="mt-1 text-xs text-muted-foreground">via {lead.source}</div>
        )}
      </div>

      {lead.notes && (
        <p className="mt-3 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
          {lead.notes}
        </p>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {awaitingNext ? (
        <>
          <div className="mt-4 flex items-center gap-2">
            <Button ref={nextRef} className="flex-1 gap-2" onClick={advance}>
              Next lead <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Call saved. Press <kbd className="font-mono">N</kbd> or Enter for the next lead.
          </p>
        </>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-2">
            <Button
              className="flex-1 gap-2"
              onClick={call}
              disabled={busy || dialing || !phone.ready}
            >
              <Phone className="h-4 w-4" />
              {dialing ? "Connecting…" : busy ? "On a call" : "Call"}
            </Button>
          </div>

          {/* Both ways past a lead sit on one row, equally weighted, because the
              choice between them matters: Skip re-queues the lead, "Already
              called" retires the number for good. The second is two-step for
              that reason — the confirm state turns the button red so an armed
              click never looks like an idle one. */}
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => fetchNext("skip", { leadId: lead.id })}
              disabled={busy || dialing}
            >
              <SkipForward className="h-4 w-4" /> Skip
            </Button>
            <Button
              variant={confirmSeen ? "destructive" : "outline"}
              className="flex-1 gap-2"
              onClick={() => {
                if (!confirmSeen) return setConfirmSeen(true);
                setConfirmSeen(false);
                void fetchNext("mark-contacted", { leadId: lead.id });
              }}
              onBlur={() => setConfirmSeen(false)}
              disabled={busy || dialing}
            >
              <CheckCheck className="h-4 w-4" />
              {confirmSeen ? "Confirm — retire it" : "Already called"}
            </Button>
          </div>

          {confirmSeen && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {lead.phone} won&apos;t be served again, here or in any other campaign.
            </p>
          )}

          {!phone.ready && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Waiting for the softphone to connect before you can call.
            </p>
          )}
        </>
      )}
    </div>,
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-5 text-center">
      {children}
    </div>
  );
}

/**
 * Campaign picker. Lists only the campaigns the rep is assigned to — the options
 * come from /api/queue/campaigns, which reads the session's rep identity, and
 * the server re-checks the choice on every serve. So this narrows what a rep is
 * handed; it can't widen it.
 *
 * Hidden when there's nothing to choose between: a rep on one campaign gets a
 * control whose only effect is to state where they already are.
 */
function CampaignPicker({
  campaigns,
  value,
  onChange,
  disabled,
}: {
  campaigns: RepCampaign[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled: boolean;
}) {
  if (campaigns.length < 2) return null;
  const total = campaigns.reduce((n, c) => n + c.waiting, 0);

  return (
    <label className="flex items-center gap-2 px-1">
      <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="sr-only">Campaign</span>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-w-0 flex-1 rounded-md border border-input bg-card px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <option value="">All my campaigns ({total} left)</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.waiting} left)
          </option>
        ))}
      </select>
    </label>
  );
}
