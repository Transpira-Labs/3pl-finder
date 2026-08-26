"use client";

import { useEffect, useState } from "react";
import {
  DownloadCloud,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Campaign = { id: string; name: string };
type Route = { tag: string; campaignId: string };
type Config = {
  campaignId: string | null;
  tag: string | null;
  routes?: Route[];
  watermark: string | null;
};

type ReportRow = {
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  linkedin: string | null;
};
type Report = {
  batchId: string;
  at: string;
  imported: ReportRow[];
  alreadyKnown: ReportRow[];
  noPhone: ReportRow[];
};
type ImportResult = {
  imported: number;
  scanned: number;
  skippedNoPhone: number;
  skippedNotTagged: number;
  truncated: boolean;
  phoneField: string | null;
  summary: { rowCount: number; duplicates: number; blocked: number; invalid: number };
};

const SELECT_CLASS =
  "rounded-md border border-input bg-card px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Saleshandy lead source. Prospects are pulled through the same validation gate
 * as every other source; only those Saleshandy holds a phone number for can
 * become dialable leads, so the panel reports that split explicitly.
 */
export function SaleshandyPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newRouteTag, setNewRouteTag] = useState("");
  const [newRouteCampaign, setNewRouteCampaign] = useState("");
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/saleshandy");
      const d = await res.json().catch(() => ({}));
      if (!active) return;
      // A 401/403 here means "not an admin", which is a very different thing from
      // "no API key" — report it as itself rather than as a missing credential.
      if (!res.ok) {
        setConfigured(false);
        setLoadError(
          res.status === 401 || res.status === 403
            ? "You need the admin role to manage lead sources."
            : (d.error ?? `Could not load (HTTP ${res.status}).`),
        );
        return;
      }
      setConfigured(!!d.configured);
      setConfig(d.config ?? null);
      setTags(d.tags ?? []);
      setReport(d.report ?? null);
      const c = await fetch("/api/campaigns")
        .then((r) => r.json())
        .catch(() => ({ campaigns: [] }));
      if (active) setCampaigns(c.campaigns ?? []);
    })().catch((e) => {
      // Never leave the panel stuck on "Checking…" — a swallowed failure here is
      // indistinguishable from the card not existing at all.
      if (!active) return;
      setConfigured(false);
      setLoadError((e as Error)?.message ?? "Could not reach the server.");
    });
    return () => {
      active = false;
    };
  }, []);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch("/api/saleshandy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: d.error ?? "Request failed" });
        return;
      }
      if (d.config) setConfig(d.config);
      if (d.tags) setTags(d.tags);
      if (typeof d.configured === "boolean") setConfigured(d.configured);
      if ("report" in d) setReport(d.report ?? null);

      if (d.verify) {
        setMsg(
          d.verify.ok
            ? { kind: "ok", text: "API key works." }
            : { kind: "err", text: d.verify.error },
        );
      } else if (d.result) {
        setMsg({ kind: "ok", text: describe(d.result as ImportResult) });
      } else if (body.action === "reset") {
        setMsg({ kind: "ok", text: "Watermark cleared — the next pull re-walks all prospects." });
      } else {
        setMsg({ kind: "ok", text: "Saved." });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Saleshandy</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Pulls <strong>prospects</strong> from Saleshandy into the calling queue. Leads
            saved in Lead Finder aren&rsquo;t prospects until you add them to a sequence or
            prospect list — until then they&rsquo;re invisible here. Enrich phone numbers
            first; prospects without one can&rsquo;t be called and are skipped.
          </p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs",
            configured === null
              ? "bg-muted text-muted-foreground"
              : configured
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-amber-500/10 text-amber-600",
          )}
        >
          {configured === null ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : configured ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          {configured === null ? "Checking…" : configured ? "Connected" : "No API key"}
        </span>
      </div>

      {loadError && (
        <p className="mt-4 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
          {loadError}
        </p>
      )}

      {configured === false && !loadError && (
        <p className="mt-4 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          Set <code className="font-mono">SALESHANDY_API_KEY</code> on the deployment, then
          reload. Generate one in Saleshandy under <strong>Settings → API Keys</strong>.
        </p>
      )}

      {configured && config && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Import into campaign</span>
              <select
                className={cn(SELECT_CLASS, "w-full")}
                value={config.campaignId ?? ""}
                onChange={(e) =>
                  void post(
                    { action: "save", campaignId: e.target.value || null },
                    "save",
                  )
                }
              >
                <option value="">— none (leads stay unassigned) —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Only prospects tagged</span>
              <select
                className={cn(SELECT_CLASS, "w-full")}
                value={config.tag ?? ""}
                onChange={(e) =>
                  void post({ action: "save", tag: e.target.value || null }, "save")
                }
              >
                <option value="">— any tag (import all) —</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Tag → campaign overrides. Checked before the tag filter, so a list
              with its own campaign imports without also widening the filter. */}
          <div className="mt-4 rounded-lg border border-border p-3">
            <div className="text-xs font-semibold">Send specific tags elsewhere</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Prospects carrying one of these tags go to its campaign instead of the
              default above, in the same import pass. First match wins.
            </p>

            <div className="mt-2 space-y-2">
              {(config.routes ?? []).map((r, i) => (
                <div key={`${r.tag}-${i}`} className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-muted px-2 py-1 text-xs font-medium">
                    {r.tag}
                  </span>
                  <span className="text-xs text-muted-foreground">→</span>
                  <span className="text-xs">
                    {campaigns.find((c) => c.id === r.campaignId)?.name ?? (
                      <em className="text-amber-600">campaign deleted</em>
                    )}
                  </span>
                  <button
                    className="ml-auto text-xs text-red-600 hover:underline"
                    onClick={() =>
                      void post(
                        {
                          action: "setRoutes",
                          routes: (config.routes ?? []).filter((_, j) => j !== i),
                        },
                        "routes",
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              {(config.routes ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No overrides yet.</p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                className={cn(SELECT_CLASS)}
                value={newRouteTag}
                onChange={(e) => setNewRouteTag(e.target.value)}
              >
                <option value="">— pick a tag —</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">→</span>
              <select
                className={cn(SELECT_CLASS)}
                value={newRouteCampaign}
                onChange={(e) => setNewRouteCampaign(e.target.value)}
              >
                <option value="">— pick a campaign —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                disabled={!newRouteTag || !newRouteCampaign || busy === "routes"}
                onClick={() => {
                  const next = [
                    ...(config.routes ?? []).filter((r) => r.tag !== newRouteTag),
                    { tag: newRouteTag, campaignId: newRouteCampaign },
                  ];
                  setNewRouteTag("");
                  setNewRouteCampaign("");
                  void post({ action: "setRoutes", routes: next }, "routes");
                }}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {busy === "routes" ? "Saving…" : "Add"}
              </button>
            </div>
          </div>

          {config.tag && (
            // A tag filter is a whole-pipeline mute switch, including the nightly
            // cron, and nothing else on the page says so. Selecting one in the
            // dropdown saves immediately, so it's easy to set by accident.
            <p className="mt-3 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-500">
              Only prospects tagged <strong>{config.tag}</strong> will ever be imported —
              by this button and by the nightly sync. Clear the tag above to import
              everything.
            </p>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Importing reads every matching prospect, so it&rsquo;s safe to run again after
            enriching phone numbers — anyone already imported is skipped automatically.
            {config.watermark
              ? ` The nightly sync last ran up to ${new Date(config.watermark).toLocaleString()}.`
              : " The nightly sync hasn't run yet."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {/*
              Always a full walk, never the incremental one. Enriching a prospect
              doesn't change its createdAt, so an incremental pull skips anyone who
              was already scanned past while they still had no phone — which is the
              normal order of events: prospects land, then get enriched. A full walk
              re-reads everything and lets the contact ledger dedupe, so the button
              means what it says. The cron still runs incrementally.
            */}
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() => void post({ action: "import", full: true }, "import")}
            >
              <DownloadCloud className="mr-1.5 h-3.5 w-3.5" />
              {busy === "import" ? "Importing…" : "Import prospects"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => void post({ action: "verify" }, "verify")}
            >
              {busy === "verify" ? "Checking…" : "Test connection"}
            </Button>
          </div>
        </>
      )}

      {msg && (
        <p
          className={cn(
            "mt-3 text-xs",
            msg.kind === "ok" ? "text-emerald-600" : "text-destructive",
          )}
        >
          {msg.text}
        </p>
      )}

      {configured && report && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs font-medium">
            Last import ·{" "}
            <span className="font-normal text-muted-foreground">
              {new Date(report.at).toLocaleString()}
            </span>
          </p>
          <div className="mt-2 space-y-1">
            <ReportGroup
              label="Imported into the queue"
              rows={report.imported}
              tone="ok"
              filename="imported"
            />
            <ReportGroup
              label="No phone number — enrich these in Saleshandy"
              rows={report.noPhone}
              tone="warn"
              filename="missing-phone"
            />
            <ReportGroup
              label="Already in the platform"
              rows={report.alreadyKnown}
              tone="muted"
              filename="already-known"
            />
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One collapsible bucket of an import result. Collapsed by default — the counts
 * are the summary, and the names are there for when a count is surprising.
 */
function ReportGroup({
  label,
  rows,
  tone,
  filename,
}: {
  label: string;
  rows: ReportRow[];
  tone: "ok" | "warn" | "muted";
  filename: string;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left text-xs"
          aria-expanded={open}
        >
          <ChevronRight
            className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
          />
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 font-mono text-[11px]",
              tone === "ok" && "bg-emerald-500/10 text-emerald-600",
              tone === "warn" && "bg-amber-500/10 text-amber-600",
              tone === "muted" && "bg-muted text-muted-foreground",
            )}
          >
            {rows.length}
          </span>
          <span className="text-muted-foreground">{label}</span>
        </button>
        <button
          type="button"
          onClick={() => downloadCsv(rows, filename)}
          className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          CSV
        </button>
      </div>
      {open && (
        <ul className="max-h-64 overflow-y-auto border-t border-border px-3 py-2 text-xs">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-2 py-0.5 text-muted-foreground">
              <span className="w-40 shrink-0 truncate text-foreground">
                {r.name || "(no name)"}
              </span>
              <span className="w-32 shrink-0 truncate font-mono text-[11px]">
                {r.phone ?? ""}
              </span>
              <span className="truncate">{r.company || r.email || ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function downloadCsv(rows: ReportRow[], name: string) {
  const cell = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    "name,phone,email,company,linkedin",
    ...rows.map((r) =>
      [r.name, r.phone, r.email, r.company, r.linkedin].map(cell).join(","),
    ),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `saleshandy-${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Turn an import result into one honest sentence, including what was dropped. */
function describe(r: ImportResult): string {
  const parts = [`Scanned ${r.scanned} Saleshandy prospect${r.scanned === 1 ? "" : "s"}`];
  parts.push(`imported ${r.imported}`);
  if (r.skippedNotTagged > 0) parts.push(`${r.skippedNotTagged} without the tag`);
  if (r.skippedNoPhone > 0) parts.push(`${r.skippedNoPhone} with no phone number`);
  if (r.summary?.duplicates > 0) parts.push(`${r.summary.duplicates} already known`);
  if (r.summary?.blocked > 0) parts.push(`${r.summary.blocked} suppressed`);
  if (r.summary?.invalid > 0) parts.push(`${r.summary.invalid} invalid`);
  let text = parts.join(", ") + ".";
  // The quiet failure: a tag filter that matches nothing looks identical to
  // "there was nothing new", so say plainly that the filter ate the whole pull.
  if (r.imported === 0 && r.skippedNotTagged === r.scanned && r.scanned > 0) {
    text += " Every prospect was filtered out by the tag — clear it above, or tag them in Saleshandy.";
  }
  if (!r.phoneField && r.skippedNoPhone > 0) {
    text += " No phone attribute found on these prospects — enrich phone numbers in Saleshandy first.";
  }
  if (r.truncated) {
    text += " Page cap reached — run Import again to pick up where this pass stopped.";
  }
  return text;
}
