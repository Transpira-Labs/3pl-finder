import { cn } from "@/lib/utils";
import type { Stage } from "./types";

type StageMeta = { label: string; cls: string };

/** Display order for filter chips + stage <select>. */
export const STAGE_ORDER: Stage[] = [
  "new",
  "contacted",
  "follow_up",
  "qualified",
  "won",
  "lost",
  "do_not_contact",
];

export const STAGE_META: Record<Stage, StageMeta> = {
  new: { label: "New", cls: "bg-sky-100 text-sky-700" },
  contacted: { label: "Contacted", cls: "bg-accent/10 text-accent" },
  follow_up: { label: "Follow-up", cls: "bg-amber-100 text-amber-700" },
  qualified: { label: "Qualified", cls: "bg-purple-100 text-purple-700" },
  won: { label: "Won", cls: "bg-green-100 text-green-700" },
  lost: { label: "Lost", cls: "bg-red-100 text-red-700" },
  do_not_contact: { label: "Do not contact", cls: "bg-secondary text-muted-foreground" },
};

export function stageLabel(stage: Stage): string {
  return STAGE_META[stage]?.label ?? stage;
}

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  const meta = STAGE_META[stage] ?? { label: stage, cls: "bg-muted text-muted-foreground" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
        meta.cls,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
