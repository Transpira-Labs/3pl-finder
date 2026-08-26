"use client";

import { memo } from "react";
import { X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { BucketId, Call } from "@/lib/types";
import { callTotal, fmt, fmtClock } from "@/lib/format";
import { dispositionLabel } from "@/lib/config";

export const HistoryTable = memo(function HistoryTable({
  calls,
  onDelete,
}: {
  calls: Call[];
  onDelete?: (id: string) => void;
}) {
  if (calls.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        No calls yet — end your first call and it shows up here.
      </div>
    );
  }

  const cell = (c: Call, id: BucketId) =>
    c.acc[id] ? fmt(c.acc[id]) : <span className="text-muted-foreground/40">·</span>;

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead className="text-right">Ring</TableHead>
            <TableHead className="text-right">Wait</TableHead>
            <TableHead className="text-right">Right</TableHead>
            <TableHead className="text-right">Wrong</TableHead>
            <TableHead className="text-right">VM</TableHead>
            <TableHead className="text-right">Dead</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="whitespace-nowrap">
                {fmtClock(c.endedAt)}
                {c.note && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{c.note}</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{cell(c, "ringing")}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{cell(c, "waiting")}</TableCell>
              <TableCell className="text-right font-mono tabular-nums text-green-700">{cell(c, "right")}</TableCell>
              <TableCell className="text-right font-mono tabular-nums text-red-700">{cell(c, "wrong")}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{cell(c, "voicemail")}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{cell(c, "noanswer")}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(callTotal(c))}</TableCell>
              <TableCell>
                <Badge variant="secondary" className="font-normal">
                  {dispositionLabel(c.disposition)}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {onDelete && (
                  <button
                    onClick={() => onDelete(c.id)}
                    className="rounded text-muted-foreground/60 outline-none transition-[transform,color] duration-150 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98]"
                    aria-label="Delete call"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
});
