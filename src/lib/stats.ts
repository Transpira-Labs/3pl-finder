import type { Call } from "./types";
import { BUCKET_IDS } from "./config";

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface Stats {
  totalCalls: number;
  todayCalls: number;
  timeRight: number;
  avgRight: number;
  timeToRight: number;
  timeWrong: number;
  timeWaiting: number;
  timeRinging: number;
  productivePct: number;
}

export function computeStats(calls: Call[]): Stats {
  const today = calls.filter((c) => c.endedAt >= startOfToday());
  const sum = (id: (typeof BUCKET_IDS)[number]) =>
    calls.reduce((s, c) => s + (c.acc[id] || 0), 0);

  const timeRight = sum("right");
  const timeWrong = sum("wrong");
  const timeWaiting = sum("waiting");
  const timeRinging = sum("ringing");
  const timeAll = calls.reduce(
    (s, c) => s + BUCKET_IDS.reduce((a, id) => a + (c.acc[id] || 0), 0),
    0,
  );
  const withRight = calls.filter((c) => (c.acc.right || 0) > 0);
  const avgRight = withRight.length ? timeRight / withRight.length : 0;
  const timeToRight = withRight.length
    ? withRight.reduce(
        (s, c) => s + (c.acc.ringing || 0) + (c.acc.waiting || 0),
        0,
      ) / withRight.length
    : 0;
  const productivePct = timeAll ? Math.round((100 * timeRight) / timeAll) : 0;

  return {
    totalCalls: calls.length,
    todayCalls: today.length,
    timeRight,
    avgRight,
    timeToRight,
    timeWrong,
    timeWaiting,
    timeRinging,
    productivePct,
  };
}
