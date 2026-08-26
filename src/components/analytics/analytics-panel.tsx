"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Plus,
  RefreshCw,
  Sheet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/format";
import { dispositionLabel, MIN_CALLS_FOR_RATE } from "@/lib/config";
import type { DailyPayload } from "@/lib/analytics/service";
import type { DayMetrics, HourMetrics } from "@/lib/analytics/stats";
import type { UserRole } from "@/lib/auth/users";
import { TrendStrip } from "./trend-strip";

/**
 * Call Analytics — what the day's calling produced, and the journal entry that
 * explains it.
 *
 * Everything here is computed in SQL on read, so the page is always current and
 * free to open. Tagging a day is what makes the numbers comparable: the trend
 * view measures days carrying a tag against the days without it.
 */

/** YYYY-MM-DD arithmetic that doesn't drift across DST. */
function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000).toISOString().slice(0, 10);
}

function prettyDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Signed change, or a dash when there's nothing to compare against. */
function delta(now: number, before: number | undefined | null, suffix = ""): string {
  if (before == null) return "—";
  const d = now - before;
  return `${d >= 0 ? "+" : ""}${Math.round(d)}${suffix}`;
}

export function AnalyticsPanel({
  initialDay,
  role,
}: {
  initialDay: string;
  role: UserRole;
}) {
  // Managers can look at the whole team or scope to just themselves; reps are
  // always scoped to themselves (the API enforces this regardless of the toggle).
  const canSeeEveryone = role === "admin";
  const [day, setDay] = useState(initialDay);
  const [scope, setScope] = useState<"all" | "me">(canSeeEveryone ? "all" : "me");
  const [data, setData] = useState<DailyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [exporting, setExporting] = useState(false);
  /** Set after a successful export so we can link straight to the new tab. */
  const [exported, setExported] = useState<{ tab: string; url: string } | null>(null);

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      setError("");
      // A link to yesterday's tab would be actively misleading on today's view.
      setExported(null);
      try {
        const qs = scope === "me" ? `?day=${target}&scope=me` : `?day=${target}`;
        const r = await fetch(`/api/analytics/daily${qs}`).then((x) => x.json());
        if (r.error) setError(r.error);
        else {
          setData(r);
          setNoteDraft(r.stats?.note?.note ?? "");
        }
      } catch {
        setError("Couldn't reach the analytics API.");
      } finally {
        setLoading(false);
      }
    },
    [scope],
  );

  /** Write the day being viewed to its own tab of the call-log Sheet. */
  const exportDay = useCallback(async () => {
    setExporting(true);
    setError("");
    try {
      const r = await fetch("/api/analytics/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "exportDay", day }),
      }).then((x) => x.json());
      if (r.ok) setExported({ tab: r.tab, url: r.url });
      else setError(r.error ?? "Couldn't export this day.");
    } catch {
      setError("Couldn't reach the analytics API.");
    } finally {
      setExporting(false);
    }
  }, [day]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(day);
  }, [day, load]);

  const post = useCallback(async (body: object) => {
    const r = await fetch("/api/analytics/daily", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((x) => x.json());
    if (r.error) setError(r.error);
    else setData(r);
  }, []);

  async function saveNote() {
    if (!data) return;
    if (noteDraft.trim() === (data.stats.note?.note ?? "").trim()) return;
    await post({ action: "saveNote", day, note: noteDraft });
  }

  async function addTag(raw: string) {
    const value = raw.trim();
    if (!value || !data) return;
    setTagDraft("");
    await post({ action: "setTags", day, tags: [...(data.stats.note?.tags ?? []), value] });
  }

  async function removeTag(tag: string) {
    if (!data?.stats.note) return;
    await post({
      action: "setTags",
      day,
      tags: data.stats.note.tags.filter((t) => t !== tag),
    });
  }

  const stats = data?.stats;
  const today = stats?.today;
  const tags = stats?.note?.tags ?? [];
  const suggestions = (data?.knownTags ?? []).filter((t) => !tags.includes(t));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setDay(shiftDay(day, -1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setDay(shiftDay(day, 1))}
            disabled={day >= initialDay}
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm text-muted-foreground">{prettyDay(day)}</span>
        </div>
        <div className="flex items-center gap-2">
          {exported && (
            <a
              href={exported.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Wrote “{exported.tab}” ↗
            </a>
          )}
          {canSeeEveryone && (
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              {(
                [
                  ["all", "Everyone"],
                  ["me", "Just me"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setScope(id)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs",
                    scope === id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={exportDay}
            disabled={exporting || loading || !today?.calls}
            title={
              today?.calls
                ? "Write this day to its own tab of the call-log Sheet. Re-exporting replaces that tab."
                : "No calls on this day"
            }
          >
            <Sheet className={cn("h-3.5 w-3.5", exporting && "animate-pulse")} />
            {exporting ? "Exporting…" : "Export to Sheet"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => load(day)}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      {loading && !data && <p className="text-sm text-muted-foreground">Loading…</p>}

      {stats && today && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Calls" value={today.calls} accent />
            <Tile
              label="Talked to a person"
              value={today.outcomes.booked + today.outcomes.conversation}
              sub={pct(today.reachedRate)}
            />
            <Tile label="Booked" value={today.outcomes.booked} sub={pct(today.bookRate)} />
            <Tile
              label="Voicemail"
              value={today.outcomes.voicemail}
              sub={pct(today.voicemailRate)}
            />
            <Tile label="No contact" value={today.outcomes.noanswer} />
            <Tile label="Talk time" value={fmt(today.totalTalkMs)} sub={`med ${fmt(today.medianTalkMs)}`} />
          </section>

          <OutcomeBar metrics={today} />

          <section className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Compared to</th>
                  <th className="px-3 py-2">Calls</th>
                  <th className="px-3 py-2">Reached</th>
                  <th className="px-3 py-2">Booked</th>
                  <th className="px-3 py-2">Voicemail</th>
                  <th className="px-3 py-2">Talk time</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">Previous day</td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {delta(today.calls, stats.priorDay?.calls)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {stats.priorDay
                      ? delta(today.reachedRate * 100, stats.priorDay.reachedRate * 100, "pp")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {delta(today.outcomes.booked, stats.priorDay?.outcomes.booked)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {delta(today.outcomes.voicemail, stats.priorDay?.outcomes.voicemail)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {stats.priorDay
                      ? delta(today.totalTalkMs / 60000, stats.priorDay.totalTalkMs / 60000, "m")
                      : "—"}
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">
                    7-day average
                    {stats.trailing7 && (
                      <span className="ml-1 text-xs">({stats.trailing7.daysCounted}d)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {delta(today.calls, stats.trailing7?.calls)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {stats.trailing7
                      ? delta(today.reachedRate * 100, stats.trailing7.reachedRate * 100, "pp")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {delta(today.outcomes.booked, stats.trailing7?.outcomes.booked)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {delta(today.outcomes.voicemail, stats.trailing7?.outcomes.voicemail)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {stats.trailing7
                      ? delta(today.totalTalkMs / 60000, stats.trailing7.totalTalkMs / 60000, "m")
                      : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {stats.sampleWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{stats.sampleWarning}</span>
            </div>
          )}

          <div className={cn("grid grid-cols-1 gap-5", canSeeEveryone && "lg:grid-cols-2")}>
            {/* The journal is the org-wide "what we did differently" log — a
                manager tool. Reps see their own numbers, not the team journal. */}
            {canSeeEveryone && (
            <Section title="What I did differently today">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onBlur={saveNote}
                rows={3}
                placeholder="e.g. opened with the pricing question instead of the intro"
                className="w-full rounded-lg border border-border bg-card p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t}
                    onClick={() => removeTag(t)}
                    className="group inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                    title="Remove tag"
                  >
                    {t}
                    <X className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addTag(tagDraft);
                    }
                  }}
                  onBlur={() => {
                    if (tagDraft) void addTag(tagDraft);
                  }}
                  placeholder="add a tag…"
                  className="w-28 rounded-full border border-dashed border-border bg-transparent px-2.5 py-0.5 text-xs outline-none focus-visible:border-solid focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Used before:</span>
                  {suggestions.slice(0, 8).map((t) => (
                    <button
                      key={t}
                      onClick={() => void addTag(t)}
                      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      {t}
                    </button>
                  ))}
                </div>
              )}

              <p className="mt-2 text-[11px] text-muted-foreground">
                Tags are how days get compared. Reuse a tag across days and the table below
                measures those days against the rest.
              </p>
            </Section>
            )}

            <div className="space-y-4">
              {Object.keys(today.dispositions).length > 0 && (
                <Section title="Outcomes">
                  <div className="space-y-1">
                    {Object.entries(today.dispositions)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, n]) => (
                        <div
                          key={k}
                          className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                        >
                          <span>{k === "none" ? "Not dispositioned" : dispositionLabel(k)}</span>
                          <span className="font-mono tabular-nums">{n}</span>
                        </div>
                      ))}
                  </div>
                </Section>
              )}

              <Section title="Where the time went">
                <div className="space-y-1">
                  {Object.entries(today.buckets)
                    .filter(([, ms]) => ms > 0)
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, ms]) => (
                      <div
                        key={id}
                        className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                      >
                        <span className="capitalize">{id}</span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {fmt(ms)}
                        </span>
                      </div>
                    ))}
                  {Object.values(today.buckets).every((ms) => ms === 0) && (
                    <p className="text-xs text-muted-foreground">
                      No tracked time — the stopwatch wasn&apos;t used on these calls.
                    </p>
                  )}
                </div>
              </Section>
            </div>
          </div>

          <HourTable
            today={stats.byHour}
            allTime={stats.byHourAllTime}
            bestHour={stats.bestHour}
          />

          {stats.byRep.length > 1 && (
            <Section title="By rep">
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {stats.byRep.map((r) => (
                  <div
                    key={r.repId}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                  >
                    <span className="truncate">{r.repName}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {r.calls} calls · {pct(r.connectRate)} · {fmt(r.totalTalkMs)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <TrendStrip day={day} scope={scope} showCohorts={canSeeEveryone} />
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline gap-1.5">
        <span className={cn("text-xl font-semibold tabular-nums", accent && "text-primary")}>
          {value}
        </span>
        {sub && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{sub}</span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** Colours are shared by the stacked bar and the hour table legend. */
const OUTCOME_STYLE = [
  { key: "booked", label: "Booked", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  { key: "conversation", label: "Talked to a person", bar: "bg-sky-500", dot: "bg-sky-500" },
  { key: "voicemail", label: "Voicemail", bar: "bg-violet-500", dot: "bg-violet-500" },
  { key: "noanswer", label: "No contact", bar: "bg-muted-foreground/30", dot: "bg-muted-foreground/30" },
] as const;

/** One bar showing how the day's calls split across the four outcomes. */
function OutcomeBar({ metrics }: { metrics: DayMetrics }) {
  if (metrics.calls === 0) return null;
  return (
    <section>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {OUTCOME_STYLE.map((o) => {
          const n = metrics.outcomes[o.key];
          if (!n) return null;
          return (
            <div
              key={o.key}
              className={o.bar}
              style={{ width: `${(n / metrics.calls) * 100}%` }}
              title={`${o.label}: ${n} of ${metrics.calls}`}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {OUTCOME_STYLE.map((o) => (
          <span key={o.key} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", o.dot)} />
            {o.label}
            <span className="font-mono tabular-nums">{metrics.outcomes[o.key]}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/**
 * Response rate by hour of day — when this list actually picks up.
 *
 * Two views: the selected day, and every day of history stacked together. The
 * all-time view is the one worth acting on; a single day rarely has enough
 * calls in any one hour to separate a good hour from a lucky one. Hours under
 * the reliability threshold are marked rather than hidden, so a 1-for-1 hour
 * can't be mistaken for a 100% hour.
 */
function HourTable({
  today,
  allTime,
  bestHour,
}: {
  today: HourMetrics[];
  allTime: HourMetrics[];
  bestHour: HourMetrics | null;
}) {
  const [scope, setScope] = useState<"day" | "all">("day");
  const rows = scope === "day" ? today : allTime;
  if (today.length === 0 && allTime.length === 0) return null;

  const maxCalls = Math.max(...rows.map((r) => r.calls), 1);
  const best =
    scope === "day"
      ? bestHour
      : ([...allTime].filter((h) => h.reliable).sort((a, b) => b.reachedRate - a.reachedRate)[0] ??
        null);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Response rate by hour
        </h2>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {(
            [
              ["day", "This day"],
              ["all", "All history"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setScope(id)}
              className={cn(
                "rounded px-2 py-0.5 text-[11px]",
                scope === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No calls in this range.</p>
      ) : (
        <>
          <div className="space-y-1">
            {rows.map((h) => (
              <div key={h.hour} className="flex items-center gap-2 text-xs">
                <span className="w-12 shrink-0 text-right font-mono text-muted-foreground">
                  {String(h.hour).padStart(2, "0")}:00
                </span>
                {/* Bar width = call volume, segments = outcome mix. */}
                <div
                  className="h-4 overflow-hidden rounded bg-muted"
                  style={{ width: `${Math.max((h.calls / maxCalls) * 100, 4)}%` }}
                  title={`${h.calls} calls`}
                >
                  <div className="flex h-full w-full">
                    {OUTCOME_STYLE.map((o) => {
                      const n =
                        o.key === "booked"
                          ? h.booked
                          : o.key === "conversation"
                            ? h.conversations - h.booked
                            : o.key === "voicemail"
                              ? h.voicemails
                              : h.noAnswers;
                      if (!n) return null;
                      return (
                        <div
                          key={o.key}
                          className={o.bar}
                          style={{ width: `${(n / h.calls) * 100}%` }}
                          title={`${o.label}: ${n}`}
                        />
                      );
                    })}
                  </div>
                </div>
                <span className="flex-1" />
                <span
                  className={cn(
                    "w-11 shrink-0 text-right font-mono tabular-nums",
                    h.reliable ? "font-medium text-foreground" : "text-muted-foreground/60",
                    best && h.hour === best.hour && "text-emerald-600",
                  )}
                  title={h.reliable ? undefined : "Too few calls for this rate to mean anything"}
                >
                  {pct(h.reachedRate)}
                </span>
                <span className="w-24 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                  {h.calls} call{h.calls === 1 ? "" : "s"}
                  {h.booked > 0 && ` · ${h.booked}★`}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Bar width = calls placed · segments = outcome mix · % = share that reached a
            person. Rates over fewer than {MIN_CALLS_FOR_RATE} calls are dimmed — they aren&apos;t
            worth reading.
            {best && (
              <>
                {" "}
                Best hour {scope === "day" ? "today" : "so far"}:{" "}
                <span className="font-medium text-emerald-600">
                  {String(best.hour).padStart(2, "0")}:00 at {pct(best.reachedRate)}
                </span>{" "}
                over {best.calls} calls.
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}
