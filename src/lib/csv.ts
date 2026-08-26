import type { Call } from "./types";
import { callTotal, fmtMs } from "./format";
import { dispositionLabel } from "./config";
import { readableTimestamp } from "./sheets";

function csvValue(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(calls: Call[]): string {
  const header = [
    "started", "ended", "ringing", "waiting", "right", "wrong",
    "voicemail", "noanswer", "total", "disposition", "note",
  ];
  const rows = calls
    .slice()
    .reverse()
    .map((c) => {
      // Durations as readable elapsed time (h:mm:ss.mmm) — matches the Sheet's
      // display, so the CSV and Google-Sheet columns line up visually.
      const ringing = fmtMs(c.acc.ringing);
      const waiting = fmtMs(c.acc.waiting);
      const right = fmtMs(c.acc.right);
      const wrong = fmtMs(c.acc.wrong);
      const voicemail = fmtMs(c.acc.voicemail);
      const noanswer = fmtMs(c.acc.noanswer);
      // Total = real call duration (start → end), not the sum of tracked buckets,
      // so it matches the actual call length even with idle gaps.
      const total = fmtMs(callTotal(c));
      return [
        readableTimestamp(c.startedAt),
        readableTimestamp(c.endedAt),
        ringing, waiting, right, wrong, voicemail, noanswer, total,
        dispositionLabel(c.disposition), c.note || "",
      ];
    });
  return [header, ...rows].map((r) => r.map(csvValue).join(",")).join("\n");
}

export function downloadCsv(calls: Call[]): void {
  const blob = new Blob([buildCsv(calls)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `call-time-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
