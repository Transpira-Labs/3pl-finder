import { and, gte, lt, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts, reps, dailyNotes } from "@/db/schema";
import { BUCKET_IDS, MIN_CALLS_FOR_RATE } from "@/lib/config";
import type { BucketId } from "@/lib/types";

/**
 * Call statistics for one day — everything the Call Analytics page shows.
 *
 * Days are bucketed in the *reporting* timezone, not UTC. `startedAt` is stored
 * as timestamptz, so an 8pm ET call is already "tomorrow" in UTC — bucketing on
 * the raw timestamp would file a rep's evening calls under the wrong day and
 * quietly corrupt every day-over-day comparison.
 */

/** How many days of history to load for the trailing average + tag cohorts. */
const HISTORY_DAYS = 45;

/**
 * What a call actually amounted to. Exactly one class per call, so the four
 * counts always sum to `calls` and read as shares of the day.
 *
 * The rep's disposition is authoritative. `reachedHuman` is a telephony flag —
 * whether the carrier bridged a leg — and it disagrees with the rep often
 * enough to be unusable on its own: on the first 48 calls it marked 10 calls as
 * human while reps dispositioned 12 as booked/callback/not-interested and ran
 * the right-person stopwatch on 22. So disposition wins outright, the stopwatch
 * breaks ties on the ambiguous dispositions, and `reachedHuman` is consulted
 * only for calls that have neither.
 */
export type OutcomeClass = "booked" | "conversation" | "voicemail" | "noanswer";

export const OUTCOME_CLASSES: OutcomeClass[] = [
  "booked",
  "conversation",
  "voicemail",
  "noanswer",
];

export const OUTCOME_LABELS: Record<OutcomeClass, string> = {
  booked: "Booked",
  conversation: "Talked to a person",
  voicemail: "Voicemail",
  noanswer: "No contact",
};

/**
 * The rep's disposition, mapped straight across. A booked meeting or a callback
 * can only follow a conversation; voicemail and no-contact can only follow the
 * absence of one. Nothing else gets a vote when one of these is set.
 */
const DISPOSITION_CLASS: Record<string, OutcomeClass> = {
  booked: "booked",
  callback: "conversation",
  not_interested: "conversation",
  voicemail: "voicemail",
  no_contact: "noanswer",
};

/** Did the rep's stopwatch see a human on the line at all? */
const humanOnTheLine = (r: CallRow) =>
  (r.repBreakdown?.right ?? 0) > 0 || (r.repBreakdown?.wrong ?? 0) > 0;

function classify(r: CallRow): OutcomeClass {
  const fromDisposition = DISPOSITION_CLASS[r.disposition ?? ""];
  if (fromDisposition) return fromDisposition;

  // `wrong_number` and `other` are genuinely ambiguous — the rep said what the
  // lead was worth, not whether anyone picked up. Let the stopwatch decide:
  // right- or wrong-person time means a human answered.
  if (r.disposition === "wrong_number" || r.disposition === "other") {
    return humanOnTheLine(r) ? "conversation" : "noanswer";
  }

  // Undispositioned. Fall back to the timers, then to the carrier flag.
  if (humanOnTheLine(r)) return "conversation";
  if ((r.repBreakdown?.voicemail ?? 0) > 0) return "voicemail";
  if (r.reachedHuman) return "conversation";
  return "noanswer";
}

function emptyOutcomes(): Record<OutcomeClass, number> {
  return { booked: 0, conversation: 0, voicemail: 0, noanswer: 0 };
}

/** A calling day's numbers. Milliseconds throughout; the UI formats. */
export type DayMetrics = {
  day: string; // YYYY-MM-DD in the reporting timezone
  calls: number;
  connects: number; // the lead's line was answered
  connectRate: number; // 0–1; 0 when no calls
  totalTalkMs: number; // wall-clock across completed calls
  medianTalkMs: number;
  longestTalkMs: number;
  /** Rep-tracked time per bucket, summed. The tracker's real signal. */
  buckets: Record<BucketId, number>;
  dispositions: Record<string, number>; // includes "none" for undispositioned
  /** Mutually exclusive outcome classes; these four sum to `calls`. */
  outcomes: Record<OutcomeClass, number>;
  /** Share of calls that reached a live prospect (booked + conversation). */
  reachedRate: number;
  /** Share of calls that ended in a booked meeting. */
  bookRate: number;
  /** Share of calls that went to voicemail. */
  voicemailRate: number;
};

/** One hour of the calling day, in the reporting timezone. */
export type HourMetrics = {
  hour: number;
  calls: number;
  connects: number; // legacy reachedHuman count, kept for continuity
  booked: number;
  conversations: number; // reached a live prospect (includes booked)
  voicemails: number;
  noAnswers: number;
  reachedRate: number;
  bookRate: number;
  /** False when the hour has too few calls for its rates to mean anything. */
  reliable: boolean;
};

export type RepMetrics = DayMetrics & { repId: string; repName: string };

export type TagCohort = {
  tag: string;
  daysWith: number;
  daysWithout: number;
  connectRateWith: number;
  connectRateWithout: number;
  avgCallsWith: number;
  avgCallsWithout: number;
  avgTalkMsWith: number;
  avgTalkMsWithout: number;
};

export type DayStats = {
  day: string;
  timezone: string;
  today: DayMetrics;
  priorDay: DayMetrics | null;
  /** Mean of the 7 days before `day` that had at least one call. */
  trailing7: (DayMetrics & { daysCounted: number }) | null;
  byRep: RepMetrics[];
  byHour: HourMetrics[];
  /** The same hourly split over the whole history window, not just this day. */
  byHourAllTime: HourMetrics[];
  /** Best hour of this day by reach rate, among hours with enough calls. */
  bestHour: HourMetrics | null;
  firstCallAt: string | null; // ISO
  lastCallAt: string | null;
  note: { note: string; tags: string[] } | null;
  tagCohorts: TagCohort[];
  /** Set when the sample is too thin to read anything into. */
  sampleWarning: string | null;
};

type CallRow = {
  startedAt: Date;
  endedAt: Date | null;
  repId: string | null;
  disposition: string | null;
  reachedHuman: boolean;
  repBreakdown: Record<string, number> | null;
};

/** YYYY-MM-DD for an instant, in the given IANA timezone. */
export function localDay(at: Date, tz: string): string {
  // en-CA gives ISO-shaped YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Hour 0–23 for an instant, in the given timezone. */
function localHour(at: Date, tz: string): number {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(at),
  );
  return Number.isFinite(h) ? h % 24 : 0;
}

/** Shift a YYYY-MM-DD by whole days without tripping over DST. */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function emptyBuckets(): Record<BucketId, number> {
  return Object.fromEntries(BUCKET_IDS.map((b) => [b, 0])) as Record<
    BucketId,
    number
  >;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Roll a set of calls into one DayMetrics. */
function metrics(day: string, rows: CallRow[]): DayMetrics {
  const durations = rows
    .filter((r) => r.endedAt)
    .map((r) => r.endedAt!.getTime() - r.startedAt.getTime())
    .filter((ms) => ms > 0);

  const buckets = emptyBuckets();
  for (const r of rows) {
    for (const id of BUCKET_IDS) buckets[id] += r.repBreakdown?.[id] ?? 0;
  }

  const dispositions: Record<string, number> = {};
  for (const r of rows) {
    const key = r.disposition ?? "none";
    dispositions[key] = (dispositions[key] ?? 0) + 1;
  }

  const outcomes = emptyOutcomes();
  for (const r of rows) outcomes[classify(r)]++;

  const connects = rows.filter((r) => r.reachedHuman).length;
  const n = rows.length;
  const reached = outcomes.booked + outcomes.conversation;
  return {
    day,
    calls: n,
    connects,
    connectRate: n ? connects / n : 0,
    totalTalkMs: durations.reduce((a, b) => a + b, 0),
    medianTalkMs: median(durations),
    longestTalkMs: durations.length ? Math.max(...durations) : 0,
    buckets,
    dispositions,
    outcomes,
    reachedRate: n ? reached / n : 0,
    bookRate: n ? outcomes.booked / n : 0,
    voicemailRate: n ? outcomes.voicemail / n : 0,
  };
}

/** Mean of a metric across days, guarding divide-by-zero. */
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/**
 * Compute one day's statistics.
 *
 * One query loads the whole history window and the buckets are built in memory.
 * That's deliberate: the database is remote (~175ms per round trip), so a dozen
 * scoped queries would cost more wall-clock than a single scan of a few thousand
 * rows.
 *
 * `repId` scopes every figure (today, prior day, trailing 7, hour histogram, tag
 * cohorts) to a single rep — a sales rep only ever sees their own analytics. It
 * filters the loaded window in memory, so scoping costs nothing extra. When set,
 * `byRep` collapses to that one rep (the panel hides it), which is intended.
 */
export async function dayStats(
  day: string,
  tz: string,
  repId?: string | null,
): Promise<DayStats> {
  const windowStart = new Date(
    Date.parse(`${addDays(day, -HISTORY_DAYS)}T00:00:00Z`) - 86_400_000,
  );
  // Include the whole of `day` in the caller's timezone whatever the offset.
  const windowEnd = new Date(Date.parse(`${addDays(day, 1)}T00:00:00Z`) + 86_400_000);

  const [rows, repRows, noteRows] = await Promise.all([
    db
      .select({
        startedAt: callAttempts.startedAt,
        endedAt: callAttempts.endedAt,
        repId: callAttempts.repId,
        disposition: callAttempts.disposition,
        reachedHuman: callAttempts.reachedHuman,
        repBreakdown: callAttempts.repBreakdown,
      })
      .from(callAttempts)
      .where(
        and(
          gte(callAttempts.startedAt, windowStart),
          lt(callAttempts.startedAt, windowEnd),
          isNotNull(callAttempts.startedAt),
          // Softphone test calls are not sales activity — they would inflate
          // volume and drag every rate down.
          ne(callAttempts.source, "test"),
        ),
      ),
    db.select({ id: reps.id, name: reps.name }).from(reps),
    db.select().from(dailyNotes),
  ]);

  const repName = new Map(repRows.map((r) => [r.id, r.name]));
  const notesByDay = new Map(noteRows.map((n) => [n.day, n]));

  // Scope to one rep before bucketing, so every downstream figure is theirs.
  const scopedRows = repId
    ? (rows as CallRow[]).filter((r) => r.repId === repId)
    : (rows as CallRow[]);

  // Bucket every call into its local day once.
  const byDay = new Map<string, CallRow[]>();
  for (const r of scopedRows) {
    const d = localDay(r.startedAt, tz);
    const list = byDay.get(d);
    if (list) list.push(r);
    else byDay.set(d, [r]);
  }

  const todayRows = byDay.get(day) ?? [];
  const today = metrics(day, todayRows);

  const priorRows = byDay.get(addDays(day, -1));
  const priorDay = priorRows ? metrics(addDays(day, -1), priorRows) : null;

  // Trailing 7 days before `day`, counting only days that had calls — averaging
  // in silent days would make any active day look like an improvement.
  const prior7 = Array.from({ length: 7 }, (_, i) => addDays(day, -(i + 1)))
    .map((d) => ({ d, rows: byDay.get(d) }))
    .filter((x): x is { d: string; rows: CallRow[] } => !!x.rows?.length)
    .map((x) => metrics(x.d, x.rows));

  const trailing7 = prior7.length
    ? {
        day: `${addDays(day, -7)}..${addDays(day, -1)}`,
        calls: Math.round(mean(prior7.map((m) => m.calls))),
        connects: Math.round(mean(prior7.map((m) => m.connects))),
        connectRate: mean(prior7.map((m) => m.connectRate)),
        totalTalkMs: Math.round(mean(prior7.map((m) => m.totalTalkMs))),
        medianTalkMs: Math.round(mean(prior7.map((m) => m.medianTalkMs))),
        longestTalkMs: Math.round(mean(prior7.map((m) => m.longestTalkMs))),
        buckets: Object.fromEntries(
          BUCKET_IDS.map((b) => [
            b,
            Math.round(mean(prior7.map((m) => m.buckets[b]))),
          ]),
        ) as Record<BucketId, number>,
        dispositions: {},
        outcomes: Object.fromEntries(
          OUTCOME_CLASSES.map((c) => [
            c,
            Math.round(mean(prior7.map((m) => m.outcomes[c]))),
          ]),
        ) as Record<OutcomeClass, number>,
        reachedRate: mean(prior7.map((m) => m.reachedRate)),
        bookRate: mean(prior7.map((m) => m.bookRate)),
        voicemailRate: mean(prior7.map((m) => m.voicemailRate)),
        daysCounted: prior7.length,
      }
    : null;

  // Per rep.
  const byRepMap = new Map<string, CallRow[]>();
  for (const r of todayRows) {
    const key = r.repId ?? "unassigned";
    const list = byRepMap.get(key);
    if (list) list.push(r);
    else byRepMap.set(key, [r]);
  }
  const byRep: RepMetrics[] = [...byRepMap.entries()]
    .map(([repId, rs]) => ({
      ...metrics(day, rs),
      repId,
      repName: repName.get(repId) ?? "Unknown rep",
    }))
    .sort((a, b) => b.calls - a.calls);

  // Hour histogram (only hours with activity). Outcomes are split per hour so
  // "when does this list actually pick up" is answerable, not just "when did we
  // dial most".
  const hourMap = new Map<number, CallRow[]>();
  for (const r of todayRows) {
    const h = localHour(r.startedAt, tz);
    const list = hourMap.get(h);
    if (list) list.push(r);
    else hourMap.set(h, [r]);
  }
  const byHour: HourMetrics[] = [...hourMap.entries()]
    .map(([hour, rs]) => {
      const m = metrics(day, rs);
      return {
        hour,
        calls: m.calls,
        connects: m.connects,
        booked: m.outcomes.booked,
        conversations: m.outcomes.booked + m.outcomes.conversation,
        voicemails: m.outcomes.voicemail,
        noAnswers: m.outcomes.noanswer,
        reachedRate: m.reachedRate,
        bookRate: m.bookRate,
        reliable: m.calls >= MIN_CALLS_FOR_RATE,
      };
    })
    .sort((a, b) => a.hour - b.hour);

  // The best hour to be dialing, judged only on hours carrying enough calls to
  // support a rate. Ties break toward the busier hour.
  const bestHour =
    [...byHour]
      .filter((h) => h.reliable)
      .sort((a, b) => b.reachedRate - a.reachedRate || b.calls - a.calls)[0] ?? null;

  // Same split across the whole history window, so a single quiet day doesn't
  // decide when to call. This is the figure worth acting on.
  const hourAllMap = new Map<number, CallRow[]>();
  for (const [, rs] of byDay) {
    for (const r of rs) {
      const h = localHour(r.startedAt, tz);
      const list = hourAllMap.get(h);
      if (list) list.push(r);
      else hourAllMap.set(h, [r]);
    }
  }
  const byHourAllTime: HourMetrics[] = [...hourAllMap.entries()]
    .map(([hour, rs]) => {
      const m = metrics(day, rs);
      return {
        hour,
        calls: m.calls,
        connects: m.connects,
        booked: m.outcomes.booked,
        conversations: m.outcomes.booked + m.outcomes.conversation,
        voicemails: m.outcomes.voicemail,
        noAnswers: m.outcomes.noanswer,
        reachedRate: m.reachedRate,
        bookRate: m.bookRate,
        reliable: m.calls >= MIN_CALLS_FOR_RATE,
      };
    })
    .sort((a, b) => a.hour - b.hour);

  const times = todayRows.map((r) => r.startedAt.getTime()).sort((a, b) => a - b);

  // Tag cohorts: for each tag on today's note, compare every day carrying that
  // tag against every day that doesn't. Day counts ride along so the agent can
  // see when a comparison rests on one or two days.
  const note = notesByDay.get(day);
  const dayMetricsAll = [...byDay.entries()]
    .filter(([, rs]) => rs.length > 0)
    .map(([d, rs]) => ({ day: d, m: metrics(d, rs), tags: notesByDay.get(d)?.tags ?? [] }));

  const tagCohorts: TagCohort[] = (note?.tags ?? []).map((tag) => {
    const withTag = dayMetricsAll.filter((x) => x.tags.includes(tag));
    const withoutTag = dayMetricsAll.filter((x) => !x.tags.includes(tag));
    return {
      tag,
      daysWith: withTag.length,
      daysWithout: withoutTag.length,
      connectRateWith: mean(withTag.map((x) => x.m.reachedRate)),
      connectRateWithout: mean(withoutTag.map((x) => x.m.reachedRate)),
      avgCallsWith: mean(withTag.map((x) => x.m.calls)),
      avgCallsWithout: mean(withoutTag.map((x) => x.m.calls)),
      avgTalkMsWith: mean(withTag.map((x) => x.m.totalTalkMs)),
      avgTalkMsWithout: mean(withoutTag.map((x) => x.m.totalTalkMs)),
    };
  });

  // Say plainly when there isn't enough here to read anything into, so a thin
  // day never looks like a result.
  const activeDays = dayMetricsAll.length;
  const sampleWarning =
    today.calls === 0
      ? "No calls were placed on this day."
      : today.calls < 10
        ? `Only ${today.calls} call${today.calls === 1 ? "" : "s"} on this day — too few to read rates from.`
        : activeDays < 5
          ? `Only ${activeDays} day${activeDays === 1 ? "" : "s"} of call history exist, so day-over-day comparisons are weak.`
          : null;

  return {
    day,
    timezone: tz,
    today,
    priorDay,
    trailing7,
    byRep,
    byHour,
    byHourAllTime,
    bestHour,
    firstCallAt: times.length ? new Date(times[0]).toISOString() : null,
    lastCallAt: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    note: note ? { note: note.note, tags: note.tags } : null,
    tagCohorts,
    sampleWarning,
  };
}

/** Per-day series for the trend charts. No LLM involved. `repId` scopes it to one rep. */
export async function daySeries(
  endDay: string,
  days: number,
  tz: string,
  repId?: string | null,
): Promise<
  {
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
  }[]
> {
  const start = new Date(Date.parse(`${addDays(endDay, -days)}T00:00:00Z`) - 86_400_000);
  const end = new Date(Date.parse(`${addDays(endDay, 1)}T00:00:00Z`) + 86_400_000);

  const [rows, noteRows] = await Promise.all([
    db
      .select({
        startedAt: callAttempts.startedAt,
        endedAt: callAttempts.endedAt,
        repId: callAttempts.repId,
        disposition: callAttempts.disposition,
        reachedHuman: callAttempts.reachedHuman,
        repBreakdown: callAttempts.repBreakdown,
      })
      .from(callAttempts)
      .where(
        and(
          gte(callAttempts.startedAt, start),
          lt(callAttempts.startedAt, end),
          ne(callAttempts.source, "test"),
        ),
      ),
    db.select().from(dailyNotes),
  ]);

  const notesByDay = new Map(noteRows.map((n) => [n.day, n]));
  const scopedRows = repId
    ? (rows as CallRow[]).filter((r) => r.repId === repId)
    : (rows as CallRow[]);
  const byDay = new Map<string, CallRow[]>();
  for (const r of scopedRows) {
    const d = localDay(r.startedAt, tz);
    const list = byDay.get(d);
    if (list) list.push(r);
    else byDay.set(d, [r]);
  }

  return Array.from({ length: days }, (_, i) => addDays(endDay, -(days - 1 - i)))
    .map((d) => {
      const m = metrics(d, byDay.get(d) ?? []);
      return {
        day: d,
        calls: m.calls,
        connects: m.connects,
        connectRate: m.connectRate,
        totalTalkMs: m.totalTalkMs,
        booked: m.outcomes.booked,
        conversations: m.outcomes.booked + m.outcomes.conversation,
        voicemails: m.outcomes.voicemail,
        reachedRate: m.reachedRate,
        tags: notesByDay.get(d)?.tags ?? [],
      };
    });
}

/** One rep's row on the leaderboard. */
export type LeaderRow = {
  repId: string;
  repName: string;
  calls: number;
  /** Calls the rep dispositioned "booked meeting" — self-reported. */
  booked: number;
  /** Of those, the ones a manager confirmed actually booked. */
  bookedVerified: number;
  /** booked / calls. */
  bookRate: number;
  /** bookedVerified / calls. */
  verifiedRate: number;
};

/**
 * The rep leaderboard: calls made and booking rates, ranked. Shown to reps and
 * managers alike, with everyone named. `booked` is what reps dispositioned;
 * `bookedVerified` is what a manager confirmed actually landed — carried side by
 * side so a claimed rate can't quietly diverge from the confirmed one.
 *
 * `sinceDay` (YYYY-MM-DD in the reporting tz) bounds the window; omit for all
 * time. Manual/unassigned calls (no repId) are excluded — a leaderboard ranks
 * people, and a call with no rep belongs to no one.
 */
export async function leaderboard(opts: {
  tz: string;
  sinceDay?: string | null;
}): Promise<LeaderRow[]> {
  const { tz, sinceDay } = opts;
  // A day's buffer around the tz boundary; the exact cut is re-checked in memory.
  const windowStart = sinceDay
    ? new Date(Date.parse(`${sinceDay}T00:00:00Z`) - 86_400_000)
    : null;

  const [rows, repRows] = await Promise.all([
    db
      .select({
        repId: callAttempts.repId,
        disposition: callAttempts.disposition,
        bookingVerified: callAttempts.bookingVerified,
        startedAt: callAttempts.startedAt,
      })
      .from(callAttempts)
      .where(
        windowStart
          ? and(
              isNotNull(callAttempts.startedAt),
              gte(callAttempts.startedAt, windowStart),
            )
          : isNotNull(callAttempts.startedAt),
      ),
    db.select({ id: reps.id, name: reps.name }).from(reps),
  ]);

  const repName = new Map(repRows.map((r) => [r.id, r.name]));

  type Acc = { calls: number; booked: number; bookedVerified: number };
  const byRep = new Map<string, Acc>();
  for (const r of rows) {
    if (!r.repId) continue; // manual/unassigned — not a person to rank
    if (sinceDay && localDay(r.startedAt, tz) < sinceDay) continue;
    const a = byRep.get(r.repId) ?? { calls: 0, booked: 0, bookedVerified: 0 };
    a.calls++;
    if (r.disposition === "booked") {
      a.booked++;
      if (r.bookingVerified) a.bookedVerified++;
    }
    byRep.set(r.repId, a);
  }

  return [...byRep.entries()]
    .map(([repId, a]) => ({
      repId,
      repName: repName.get(repId) ?? "Unknown rep",
      calls: a.calls,
      booked: a.booked,
      bookedVerified: a.bookedVerified,
      bookRate: a.calls ? a.booked / a.calls : 0,
      verifiedRate: a.calls ? a.bookedVerified / a.calls : 0,
    }))
    .sort((x, y) => y.calls - x.calls || y.bookedVerified - x.bookedVerified);
}
