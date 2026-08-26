"use client";

import { CalendarClock, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/format";
import { STAGE_META, STAGE_ORDER, StageBadge, stageLabel } from "./stage-badge";
import type { PipelineLead, PipelineSummary, Stage } from "./types";

const LIMIT = 50;

function when(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? "—" : fmtClock(t);
}

export function LeadTable({
  leads,
  total,
  offset,
  onOffset,
  q,
  onQ,
  stageFilter,
  onStageFilter,
  summary,
  selectedId,
  onSelect,
}: {
  leads: PipelineLead[];
  total: number;
  offset: number;
  onOffset: (n: number) => void;
  q: string;
  onQ: (s: string) => void;
  stageFilter: Stage | null;
  onStageFilter: (s: Stage | null) => void;
  summary: PipelineSummary | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + LIMIT, total);

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
      {/* Search + stage filter */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Search name, company, phone…"
          className="pl-8"
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <FilterChip
          active={stageFilter === null}
          label="All"
          onClick={() => onStageFilter(null)}
        />
        {STAGE_ORDER.map((s) => (
          <FilterChip
            key={s}
            active={stageFilter === s}
            label={stageLabel(s)}
            count={summary?.stages?.[s]}
            className={stageFilter === s ? STAGE_META[s].cls : undefined}
            onClick={() => onStageFilter(s)}
          />
        ))}
      </div>

      {/* Table */}
      <div className="mt-3 min-h-0 flex-1 overflow-auto">
        {leads.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Users className="h-6 w-6 opacity-40" />
            <p className="font-medium text-foreground">No leads here</p>
            <p className="text-xs">
              {q || stageFilter
                ? "Try clearing the search or stage filter."
                : "Eligible leads appear here once ingested and dialed."}
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-background/80 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur-md">
              <tr className="border-b border-border">
                <th className="px-2 py-2 font-medium">Lead</th>
                <th className="px-2 py-2 font-medium">Phone</th>
                <th className="px-2 py-2 font-medium">Stage</th>
                <th className="px-2 py-2 font-medium">Last contacted</th>
                <th className="px-2 py-2 font-medium">Next follow-up</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const selected = l.id === selectedId;
                return (
                  <tr
                    key={l.id}
                    onClick={() => onSelect(l.id)}
                    tabIndex={0}
                    role="button"
                    aria-selected={selected}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(l.id);
                      }
                    }}
                    className={cn(
                      "cursor-pointer border-b border-border/60 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      selected && "border-l-2 border-l-accent bg-muted",
                    )}
                  >
                    <td className="px-2 py-2">
                      <div className="font-medium">{l.name ?? "Unknown"}</div>
                      {l.company && (
                        <div className="text-xs text-muted-foreground">{l.company}</div>
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{l.phone}</td>
                    <td className="px-2 py-2">
                      <StageBadge stage={l.pipelineStage} />
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {when(l.lastContacted)}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {l.nextFollowUp ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <CalendarClock className="h-3 w-3" />
                          {when(l.nextFollowUp.dueAt)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
          <span>
            {from}–{to} of {total}
          </span>
          <div className="flex gap-1.5">
            <Button
              size="xs"
              variant="outline"
              disabled={offset === 0}
              onClick={() => onOffset(Math.max(0, offset - LIMIT))}
            >
              Prev
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={to >= total}
              onClick={() => onOffset(offset + LIMIT)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  count,
  className,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-0.5 text-xs font-medium outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98]",
        active
          ? className ?? "bg-accent text-accent-foreground"
          : "bg-secondary text-muted-foreground hover:bg-secondary/70",
      )}
    >
      {label}
      {typeof count === "number" && <span className="ml-1 opacity-70">{count}</span>}
    </button>
  );
}
