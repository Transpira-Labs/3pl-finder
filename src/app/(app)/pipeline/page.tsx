"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Calendar,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Phone,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type {
  Activity,
  LeadBase,
  PipelineLead,
  PipelineSummary,
  Stage,
} from "@/components/pipeline/types";

const STAGES: { key: Stage; labelKey: `stage.${string}`; color: string; bgLight: string }[] = [
  { key: "new", labelKey: "stage.new", color: "bg-blue-100 text-blue-700", bgLight: "border-blue-200 bg-blue-50" },
  { key: "contacted", labelKey: "stage.contacted", color: "bg-amber-100 text-amber-700", bgLight: "border-amber-200 bg-amber-50" },
  { key: "follow_up", labelKey: "stage.follow_up", color: "bg-purple-100 text-purple-700", bgLight: "border-purple-200 bg-purple-50" },
  { key: "qualified", labelKey: "stage.qualified", color: "bg-emerald-100 text-emerald-700", bgLight: "border-emerald-200 bg-emerald-50" },
  { key: "won", labelKey: "stage.won", color: "bg-green-100 text-green-800", bgLight: "border-green-200 bg-green-50" },
  { key: "lost", labelKey: "stage.lost", color: "bg-red-100 text-red-700", bgLight: "border-red-200 bg-red-50" },
  { key: "do_not_contact", labelKey: "stage.do_not_contact", color: "bg-gray-100 text-gray-600", bgLight: "border-gray-200 bg-gray-50" },
];

function stageColor(s: Stage) {
  return STAGES.find((x) => x.key === s)?.color ?? "bg-secondary text-muted-foreground";
}

function timeAgoFn(iso: string | null, tFn: (k: any) => string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return tFn("time.justNow");
  if (mins < 60) return `${mins}${tFn("time.mAgo")}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}${tFn("time.hAgo")}`;
  const days = Math.floor(hrs / 24);
  return `${days}${tFn("time.dAgo")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function PipelinePage() {
  const { t, locale } = useI18n();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stageLabel = (s: Stage) => t(STAGES.find((x) => x.key === s)?.labelKey as any ?? `stage.${s}` as any);
  const es = locale === "es";

  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [stageFilter, setStageFilter] = useState<Stage | null>(null);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Detail
  const [detail, setDetail] = useState<LeadBase | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [enrichData, setEnrichData] = useState<any>(null);

  // Note composer
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);

  // Follow-up date
  const [followUpDate, setFollowUpDate] = useState("");

  const loadLeads = useCallback(async () => {
    const params = new URLSearchParams();
    if (stageFilter) params.set("stage", stageFilter);
    if (q.trim()) params.set("q", q.trim());
    params.set("limit", "100");
    const r = await fetch(`/api/leads?${params.toString()}`).then((x) => x.json());
    if (r.leads) {
      setLeads(r.leads);
      setSummary(r.summary ?? null);
    }
  }, [stageFilter, q]);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setNoteText("");
    setFollowUpDate("");
    setEnrichData(null);
    try {
      const r = await fetch(`/api/leads/${id}`).then((x) => x.json());
      if (r.lead) {
        setDetail(r.lead);
        setActivities(r.activities ?? []);
        setEnrichData(r.lead.enrichmentData ?? null);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function changeStage(next: Stage) {
    if (!selectedId || !detail || next === detail.pipelineStage) return;
    setDetail({ ...detail, pipelineStage: next });
    await fetch(`/api/leads/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineStage: next }),
    });
    loadDetail(selectedId);
    loadLeads();
  }

  async function addNote() {
    if (!selectedId || !noteText.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/leads/${selectedId}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "note", body: noteText.trim() }),
      });
      setNoteText("");
      loadDetail(selectedId);
    } finally {
      setSaving(false);
    }
  }

  async function scheduleFollowUp() {
    if (!selectedId || !followUpDate) return;
    setSaving(true);
    try {
      await fetch(`/api/leads/${selectedId}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "note",
          body: `${es ? "Seguimiento programado para" : "Follow-up scheduled for"} ${formatDate(followUpDate)}`,
          followUp: {
            channel: "call",
            dueAt: new Date(followUpDate).toISOString(),
          },
        }),
      });
      setFollowUpDate("");
      loadDetail(selectedId);
    } finally {
      setSaving(false);
    }
  }

  const totalLeads = summary
    ? Object.values(summary.stages).reduce((a, b) => a + b, 0)
    : leads.length;

  return (
    <main className="flex h-[calc(100vh)] overflow-hidden">
      {/* Left: Lead list */}
      <div className="flex w-[380px] shrink-0 flex-col border-r">
        {/* Header */}
        <div className="border-b px-5 py-4">
          <h1 className="font-display text-lg font-bold">{t("pipeline.title")}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{totalLeads} {t("pipeline.storesTracked")}</p>
        </div>

        {/* Search */}
        <div className="border-b px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("pipeline.searchStores")}
              className="pl-8 h-8"
            />
          </div>
        </div>

        {/* Stage filter chips */}
        <div className="flex flex-wrap gap-1 border-b px-3 py-2">
          <button
            type="button"
            onClick={() => setStageFilter(null)}
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
              !stageFilter
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {t("pipeline.all")} {totalLeads}
          </button>
          {STAGES.filter((s) => (summary?.stages?.[s.key] ?? 0) > 0).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStageFilter(stageFilter === s.key ? null : s.key)}
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                stageFilter === s.key
                  ? s.color
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {stageLabel(s.key)} {summary?.stages?.[s.key] ?? 0}
            </button>
          ))}
        </div>

        {/* Lead list */}
        <div className="flex-1 overflow-y-auto">
          {leads.length === 0 && (
            <div className="px-4 py-12 text-center">
              <Building2 className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">
                {t("pipeline.noStores")}
              </p>
            </div>
          )}
          {leads.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => loadDetail(lead.id)}
              className={cn(
                "flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
                selectedId === lead.id && "bg-muted",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {lead.name ?? lead.company ?? "Unknown"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {lead.phone ?? (es ? "Sin teléfono" : "No phone")}
                </p>
                {lead.lastActivity && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground/70 truncate">
                    {lead.lastActivity.body}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", stageColor(lead.pipelineStage))}>
                  {stageLabel(lead.pipelineStage)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {timeAgoFn(lead.createdAt, t)}
                </span>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
            </button>
          ))}
        </div>
      </div>

      {/* Right: Detail pane */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedId && (
          <div className="flex flex-1 items-center justify-center bg-muted/20">
            <div className="text-center">
              <UserRound className="mx-auto h-10 w-10 text-muted-foreground/20" />
              <p className="mt-3 text-sm font-medium text-muted-foreground/70">{t("pipeline.selectStore")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground/50">{t("pipeline.selectStoreHint")}</p>
            </div>
          </div>
        )}

        {selectedId && detailLoading && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">{t("pipeline.loading")}</p>
          </div>
        )}

        {selectedId && detail && !detailLoading && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Store header */}
            <div className="border-b px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{detail.name ?? "Unknown Company"}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {detail.company && detail.company !== detail.name && (
                      <span className="inline-flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        {detail.company}
                      </span>
                    )}
                    {detail.phone && (
                      <a href={`tel:${detail.phone}`} className="inline-flex items-center gap-1 hover:text-primary">
                        <Phone className="h-3.5 w-3.5" />
                        {detail.phone}
                      </a>
                    )}
                  </div>
                </div>

                {/* Stage selector */}
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("pipeline.stage")}</p>
                  <select
                    value={detail.pipelineStage}
                    onChange={(e) => changeStage(e.target.value as Stage)}
                    className={cn(
                      "mt-0.5 rounded-full px-3 py-1 text-xs font-semibold outline-none cursor-pointer",
                      stageColor(detail.pipelineStage),
                    )}
                  >
                    {STAGES.map((s) => (
                      <option key={s.key} value={s.key}>{stageLabel(s.key)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Quick actions */}
              <div className="mt-3 flex flex-wrap gap-2">
                {detail.phone && (
                  <a
                    href={`tel:${detail.phone}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {t("pipeline.call")}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => document.getElementById("note-input")?.focus()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t("pipeline.addNote")}
                </button>
                {/* View in discovery (if placeId exists) */}
                {(detail as any).placeId && (
                  <Link
                    href={`/discovery`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {es ? "Ver en Descubrir" : "View in Discovery"}
                  </Link>
                )}
                {/* Delete */}
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(es ? "¿Eliminar esta empresa del pipeline?" : "Remove this company from pipeline?")) return;
                    await fetch(`/api/leads/${selectedId}`, { method: "DELETE" });
                    setSelectedId(null);
                    setDetail(null);
                    loadLeads();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {es ? "Eliminar" : "Remove"}
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

              {/* AI Sales Brief */}
              {enrichData?.summary && (
                <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wider">
                    {es ? "Resumen de Ventas IA" : "AI Sales Brief"}
                  </p>

                  <p className="text-sm leading-relaxed">{enrichData.summary.overview}</p>

                  {/* Sales Angle — most important for tracking */}
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-0.5">
                      {es ? "Ángulo de Venta" : "Sales Angle"}
                    </p>
                    <p className="text-sm leading-relaxed">{enrichData.summary.salesAngle}</p>
                  </div>

                  {/* Products as compact chips */}
                  {enrichData.summary.productsCarried?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                        {es ? "Productos" : "Products"}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {enrichData.summary.productsCarried.map((p: string, i: number) => (
                          <span key={i} className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium border">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-background p-2 border">
                      <p className="text-[10px] text-muted-foreground">{es ? "Tamaño" : "Size"}</p>
                      <p className="text-sm font-semibold">{enrichData.summary.estimatedSize}</p>
                    </div>
                    <div className="rounded-lg bg-background p-2 border">
                      <p className="text-[10px] text-muted-foreground">{es ? "Ingresos Est." : "Est. Revenue"}</p>
                      <p className="text-sm font-semibold">{enrichData.summary.estimatedRevenue}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Follow-up scheduler */}
              <div className="rounded-xl border p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  <Calendar className="inline h-3.5 w-3.5 mr-1" />
                  {es ? "Programar Seguimiento" : "Schedule Follow-up"}
                </p>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={scheduleFollowUp}
                    disabled={!followUpDate || saving}
                  >
                    {es ? "Programar" : "Schedule"}
                  </Button>
                </div>
              </div>

              {/* Activity timeline */}
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  {t("pipeline.activity")}
                </p>

                {activities.length === 0 && (
                  <div className="rounded-lg border border-dashed p-6 text-center">
                    <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground/40" />
                    <p className="mt-2 text-sm text-muted-foreground">{t("pipeline.noActivity")}</p>
                    <p className="text-xs text-muted-foreground/70">{t("pipeline.noActivityHint")}</p>
                  </div>
                )}

                <div className="space-y-3">
                  {activities.map((a) => (
                    <div key={a.id} className="flex gap-3">
                      <div className={cn(
                        "mt-1 h-2 w-2 shrink-0 rounded-full",
                        a.kind === "stage_change" ? "bg-primary" :
                        a.kind === "outcome" ? "bg-amber-400" :
                        a.kind === "followup" ? "bg-purple-400" :
                        a.kind === "note" ? "bg-blue-400" :
                        "bg-muted-foreground/30",
                      )} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{a.body}</p>
                        <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                          {timeAgoFn(a.createdAt, t)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Note input — always visible at bottom */}
            <div className="border-t px-6 py-3">
              <div className="flex gap-2">
                <Input
                  id="note-input"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && addNote()}
                  placeholder={t("pipeline.notePlaceholder")}
                  className="flex-1"
                  disabled={saving}
                />
                <Button
                  size="sm"
                  onClick={addNote}
                  disabled={!noteText.trim() || saving}
                >
                  {t("pipeline.save")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
