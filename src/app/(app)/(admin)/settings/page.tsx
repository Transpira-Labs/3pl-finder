"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Users as UsersIcon,
  Plug,
  FileSpreadsheet,
  CheckCircle2,
  Check,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SaleshandyPanel } from "@/components/saleshandy-panel";
import { pingSheet } from "@/lib/sheets";

type Tab = "team" | "ingestion" | "connections";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("team");
  const tabs: { id: Tab; label: string; icon: typeof UsersIcon }[] = [
    { id: "team", label: "Team", icon: UsersIcon },
    { id: "ingestion", label: "Lead ingestion", icon: FileSpreadsheet },
    { id: "connections", label: "Connections", icon: Plug },
  ];
  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="mb-6">
        <p className="eyebrow">Admin</p>
        <h1 className="font-display mt-1 text-2xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Team access, where leads come from, and integration status — all in one place, no
          terminal required.
        </p>
      </header>

      <div className="mb-6 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "team" && <TeamPanel />}
      {tab === "ingestion" && <IngestionPanel />}
      {tab === "connections" && <ConnectionsPanel />}
    </main>
  );
}

// ── Team ─────────────────────────────────────────────────────────────────────
type UserRow = { id: string; email: string; name: string | null; role: "none" | "rep" | "admin"; createdAt: string };
const ROLES: UserRow["role"][] = ["none", "rep", "admin"];

function TeamPanel() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await fetch("/api/users").then((x) => x.json());
      if (active) setRows(r.users ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function setRole(userId: string, role: UserRow["role"]) {
    setSavingId(userId);
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    setSavingId(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Could not update role.");
      return;
    }
    setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold">Team & roles</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        <b>none</b> = no access · <b>rep</b> = call console only · <b>admin</b> = everything. New
        signups start as <b>none</b>; promote them here. The very first admin is claimed on the
        access screen — no command line.
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No users yet.</td>
              </tr>
            )}
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{u.name ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{u.email}</td>
                <td className="px-3 py-2">
                  <div className="inline-flex overflow-hidden rounded-md border border-border">
                    {ROLES.map((r) => (
                      <button
                        key={r}
                        disabled={savingId === u.id || u.role === r}
                        onClick={() => setRole(u.id, r)}
                        className={cn(
                          "px-2.5 py-1 text-xs font-medium transition-colors",
                          u.role === r
                            ? r === "admin"
                              ? "bg-primary text-primary-foreground"
                              : r === "rep"
                                ? "bg-emerald-600 text-white"
                                : "bg-muted text-muted-foreground"
                            : "bg-card text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Lead ingestion ───────────────────────────────────────────────────────────
function IngestionPanel() {
  return (
    <section className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Where leads come from. Every source runs through the same validation gate — phone
        normalisation, suppression, and dedupe — so a lead can only reach the queue once.
        One-off CSV/XLSX uploads live on the Leads page.
      </p>
      <SaleshandyPanel />
    </section>
  );
}

// ── Connections ──────────────────────────────────────────────────────────────
type Connections = {
  telephony: {
    configured: boolean;
    number: string | null;
    twimlAppConfigured: boolean;
    voiceUrl: string;
    inboundVoiceUrl: string;
  };
  leadSources: { saleshandy: boolean };
  sheets: { configured: boolean; serviceAccount: string | null };
  sms: {
    configured: boolean;
    from: string | null;
    drafting: boolean;
    inboundUrl: string;
  };
};

function ConnectionRow({ ok, title, children }: { ok: boolean; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
        <span className="text-sm font-semibold">{title}</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs font-medium", ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
          {ok ? "Connected" : "Not configured"}
        </span>
      </div>
      {children && <div className="mt-2 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * Where a returned voicemail rings. Personal cells rather than the softphone:
 * callbacks arrive hours later, when no console tab is open.
 */
function InboundForwardingPanel({ inboundVoiceUrl }: { inboundVoiceUrl: string }) {
  const [numbers, setNumbers] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const d = await fetch("/api/settings").then((r) => r.json());
      if (!active) return;
      const list: string[] = d.inboundForwardNumbers ?? [];
      setSaved(list);
      setNumbers(list.join(", "));
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    const parsed = numbers
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    // Reject before saving rather than silently dropping: a typo'd cell that
    // vanishes on save looks like it worked and misses real callbacks.
    const bad = parsed.filter((n) => !/^\+[1-9]\d{7,14}$/.test(n));
    if (bad.length) {
      setBusy(false);
      setMsg({
        kind: "err",
        text: `Not E.164 (needs a leading + and country code): ${bad.join(", ")}`,
      });
      return;
    }
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setInboundForwardNumbers", numbers: parsed }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: d.error ?? `Couldn't save (HTTP ${res.status}).` });
        return;
      }
      const list: string[] = d.inboundForwardNumbers ?? [];
      setSaved(list);
      setMsg({
        kind: "ok",
        text: list.length
          ? `Inbound calls ring ${list.length} number${list.length === 1 ? "" : "s"}.`
          : "Inbound forwarding is off — callbacks will be hung up.",
      });
    } catch {
      setMsg({ kind: "err", text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold">Inbound calls (voicemail callbacks)</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        When a lead calls the Twilio number back, these cells ring at the same time and
        the first to answer takes it. Personal cells, not the browser softphone —
        callbacks usually land long after the console is closed. E.164, comma-separated
        (e.g. <code className="rounded bg-muted px-1">+15551234567</code>). Leave empty to
        hang up on inbound calls.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={numbers}
          onChange={(e) => setNumbers(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          placeholder="+15551234567, +15559876543"
          className="min-w-[280px] flex-1 rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {msg && (
        <p
          className={cn(
            "mt-2 text-xs",
            msg.kind === "ok" ? "text-emerald-600" : "text-red-600",
          )}
        >
          {msg.text}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Saving is not enough on its own: in the Twilio console, set the{" "}
        <b>number&apos;s</b> Voice Request URL (Phone Numbers → your number → Voice) to{" "}
        <code className="rounded bg-muted px-1">{inboundVoiceUrl}</code>, method POST.
        That is a different setting from the TwiML App used for outbound.
        {saved.length === 0 && " Inbound is currently off."}
      </p>
    </section>
  );
}

function ConnectionsPanel() {
  const [c, setC] = useState<Connections | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const d = await fetch("/api/settings").then((r) => r.json());
      if (active) setC(d.connections);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!c) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Credentials live in your deployment&apos;s environment (never shown or edited here for
        security). This is the at-a-glance health of each integration.
      </p>

      <ConnectionRow ok={c.telephony.configured} title="Telephony (Twilio)">
        Caller ID: <b>{c.telephony.number ?? "—"}</b>
        <div className="mt-1">
          {c.telephony.twimlAppConfigured ? (
            <>
              TwiML App connected. Its Voice Request URL must be{" "}
              <code className="rounded bg-muted px-1">{c.telephony.voiceUrl}</code>.
            </>
          ) : (
            <>
              Reps can&apos;t place calls yet. In the Twilio console create a TwiML App
              with Voice Request URL{" "}
              <code className="rounded bg-muted px-1">{c.telephony.voiceUrl}</code>,
              then set <code className="rounded bg-muted px-1">TWILIO_TWIML_APP_SID</code>{" "}
              in your environment.
            </>
          )}
        </div>
      </ConnectionRow>

      <ConnectionRow ok={c.sms.configured && c.sms.drafting} title="SMS follow-ups (Twilio)">
        Sends from <b>{c.sms.from ?? "—"}</b> — always the same number reps call from.
        <div className="mt-1">
          {!c.sms.configured && (
            <>
              Needs <code className="rounded bg-muted px-1">TWILIO_NUMBER</code> and Twilio
              credentials in the environment.{" "}
            </>
          )}
          {!c.sms.drafting && (
            <>
              Drafting needs <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code>.{" "}
            </>
          )}
          For STOP replies to register, set the number&apos;s &quot;A message comes in&quot;
          webhook to <code className="rounded bg-muted px-1">{c.sms.inboundUrl}</code>.
        </div>
      </ConnectionRow>

      <ConnectionRow ok={c.sheets.configured} title="Google Sheets">
        Service account: <b>{c.sheets.serviceAccount ?? "—"}</b>
      </ConnectionRow>

      <InboundForwardingPanel inboundVoiceUrl={c.telephony.inboundVoiceUrl} />

      <CallLogSheetPanel
        serviceAccount={c.sheets.serviceAccount}
        credentialsConfigured={c.sheets.configured}
      />

      <p className="pt-1 text-xs text-muted-foreground">
        The ingestion worker shows live status in the corner Services widget.
      </p>
    </section>
  );
}

// ── Call-log sheet (auto-append every finished Call Console call) ─────────────
function CallLogSheetPanel({
  serviceAccount,
  credentialsConfigured,
}: {
  serviceAccount: string | null;
  credentialsConfigured: boolean;
}) {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "muted" | "ok" | "err" } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const d = await fetch("/api/settings").then((r) => r.json());
      if (active) setUrl(d.consoleSheetUrl ?? "");
    })();
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setStatus(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setConsoleSheetUrl", sheetUrl: url.trim() }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const d = await res.json().catch(() => ({}));
        setStatus({ text: d.error ?? "Could not save.", tone: "err" });
      }
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    const u = url.trim();
    if (!u) return setStatus({ text: "Paste a Google Sheet link first.", tone: "muted" });
    setStatus({ text: "Testing connection…", tone: "muted" });
    try {
      const r = await pingSheet(u);
      if (r.ok) {
        setStatus({ text: "Connected — finished calls will auto-append.", tone: "ok" });
      } else {
        const share = r.email ? ` Share the Sheet with ${r.email} (Editor).` : "";
        setStatus({ text: (r.error ?? "Could not connect.") + share, tone: "err" });
      }
    } catch (e) {
      setStatus({ text: "Could not reach the server: " + (e as Error).message, tone: "err" });
    }
  };

  const toneClass = { muted: "text-muted-foreground", ok: "text-emerald-600", err: "text-red-600" };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold">Call-log sheet (time trackers)</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Paste one Google Sheet link and every finished Call Console call — dialer, rep, and solo —
        auto-appends here as a row (start/end, ring/talk/hold seconds, disposition, note) the moment
        it&apos;s saved. Rows de-dupe by call id, so nothing double-logs. Leave blank to turn
        auto-logging off.
      </p>
      {!credentialsConfigured && (
        <p className="mt-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-700">
          Google Sheets credentials aren&apos;t set on the server yet — this won&apos;t write until
          they are. See SHEETS_SETUP.md.
        </p>
      )}
      <div className="mt-3 space-y-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste your Google Sheet link…"
          className="text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="gap-1" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={test}>Test</Button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {status && <span className={cn("text-xs", toneClass[status.tone])}>{status.text}</span>}
        </div>
        {serviceAccount && (
          <p className="text-xs text-muted-foreground">
            Share the Sheet with <b className="font-mono">{serviceAccount}</b> (Editor) so the server
            can write to it.
          </p>
        )}
      </div>
    </section>
  );
}
