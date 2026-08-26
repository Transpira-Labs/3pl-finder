"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/format";

/**
 * Trend over the last 30 days plus the tag-cohort table — the payoff for keeping
 * a daily journal. No model involved: this is straight SQL, so it's free to load
 * and always current.
 *
 * The day counts on each cohort row are deliberately visible. A tag with two
 * days behind it isn't evidence, and the table should make that obvious rather
 * than presenting a percentage that looks authoritative.
 */

type Trend = {
  timezone: string;
  days: number;
  series: {
    day: string;
    calls: number;
    connects: number;
    connectRate: number;
    totalTalkMs: number;
    booked: number;
    conversations: number;
    voicemails: number;
    reachedRate: number;
    tags: string[];
  }[];
  cohorts: {
    tag: string;
    daysWith: number;
    daysWithout: number;
    connectRateWith: number;
    connectRateWithout: number;
    avgCallsWith: number;
    avgCallsWithout: number;
  }[];
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function TrendStrip({
  day,
  scope = "all",
  showCohorts = true,
}: {
  day: string;
  /** "me" scopes the series to the current user; the API resolves the repId. */
  scope?: "all" | "me";
  /** Cohort analysis is a manager tool (tags are org-wide); hidden for reps. */
  showCohorts?: boolean;
}) {
  const [data, setData] = useState<Trend | null>(null);

  useEffect(() => {
    let active = true;
    const qs = scope === "me" ? `&scope=me` : "";
    fetch(`/api/analytics/trend?days=30&day=${day}${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (active && !d.error) setData(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [day, scope]);

  if (!data) return null;

  const active = data.series.filter((d) => d.calls > 0);
  if (active.length === 0) return null;

  const maxCalls = Math.max(...data.series.map((d) => d.calls), 1);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Last 30 days
        </h2>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex h-24 items-end gap-[3px]">
            {data.series.map((d) => (
              <div
                key={d.day}
                className="group relative flex-1"
                title={`${d.day}: ${d.calls} calls · ${d.conversations} reached (${pct(d.reachedRate)}) · ${d.booked} booked · ${d.voicemails} voicemail · ${fmt(d.totalTalkMs)} talk${d.tags.length ? ` · ${d.tags.join(", ")}` : ""}`}
              >
                <div
                  className={cn(
                    "w-full rounded-t transition-colors",
                    d.day === day ? "bg-primary" : d.tags.length ? "bg-primary/45" : "bg-muted-foreground/25",
                    "group-hover:bg-primary/70",
                  )}
                  style={{ height: `${Math.max((d.calls / maxCalls) * 96, d.calls ? 3 : 0)}px` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{data.series[0]?.day}</span>
            <span>
              bar height = calls · shaded = day has a journal note ·{" "}
              {active.length} active {active.length === 1 ? "day" : "days"}
            </span>
            <span>{data.series[data.series.length - 1]?.day}</span>
          </div>
        </div>
      </div>

      {showCohorts && data.cohorts.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What each change looks like
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Tag</th>
                  <th className="px-3 py-2">Days</th>
                  <th className="px-3 py-2">Reached (tagged)</th>
                  <th className="px-3 py-2">Reached (other days)</th>
                  <th className="px-3 py-2">Calls/day</th>
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((c) => {
                  const thin = c.daysWith < 3 || c.daysWithout < 3;
                  return (
                    <tr key={c.tag} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{c.tag}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className={cn(thin && "text-amber-600")}>
                          {c.daysWith} vs {c.daysWithout}
                          {thin && " · too few"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">
                        {c.daysWith ? pct(c.connectRateWith) : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                        {c.daysWithout ? pct(c.connectRateWithout) : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                        {c.avgCallsWith.toFixed(1)} vs {c.avgCallsWithout.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Comparisons over days that had calls. A tag needs several days on both sides
            before the difference means anything — treat these as prompts for what to test,
            not as results.
          </p>
        </div>
      )}
    </section>
  );
}
