import Link from "next/link";
import { requirePage } from "@/lib/auth/guards";
import { repIdForUser } from "@/lib/auth/rep";
import { currentDay, reportingTimezone } from "@/lib/analytics/service";
import { leaderboard, addDays } from "@/lib/analytics/stats";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Team leaderboard — calls placed and booking rates, ranked and named. Visible to
 * reps and managers alike. "Booked" is what reps logged; "Verified" is what a
 * manager confirmed in the Booked meetings queue, shown side by side so a claimed
 * rate can't quietly drift from the confirmed one.
 */

const RANGES = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "all", label: "All time", days: null },
] as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { session } = await requirePage(["rep", "admin"]);
  const { range: rangeParam } = await searchParams;
  const range = RANGES.find((r) => r.id === rangeParam) ?? RANGES[1];

  const [tz, today, myRepId] = await Promise.all([
    reportingTimezone(),
    currentDay(),
    repIdForUser(session.user.id),
  ]);
  const sinceDay = range.days ? addDays(today, -(range.days - 1)) : null;
  const rows = await leaderboard({ tz, sinceDay });

  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="mb-6">
        <p className="eyebrow">Team</p>
        <h1 className="font-display mt-1 text-2xl">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Calls placed and how many turned into booked meetings. &ldquo;Booked&rdquo;
          is what reps logged; &ldquo;Verified&rdquo; is what a manager confirmed
          actually landed.
        </p>
      </header>

      <div className="mb-4 flex w-fit items-center gap-1 rounded-md border border-border p-0.5">
        {RANGES.map((r) => (
          <Link
            key={r.id}
            href={`/leaderboard?range=${r.id}`}
            className={cn(
              "rounded px-3 py-1 text-xs",
              r.id === range.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          No calls in this range yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2">#</th>
                <th className="px-3 py-2">Rep</th>
                <th className="px-3 py-2 text-right">Calls</th>
                <th className="px-3 py-2 text-right">Booked</th>
                <th className="px-3 py-2 text-right">Book rate</th>
                <th className="px-3 py-2 text-right">Verified</th>
                <th className="px-3 py-2 text-right">Verified rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const me = r.repId === myRepId;
                return (
                  <tr
                    key={r.repId}
                    className={cn("border-t border-border", me && "bg-primary/5")}
                  >
                    <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {r.repName}
                      {me && (
                        <span className="ml-2 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-normal text-primary">
                          you
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.calls}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.booked}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {pct(r.bookRate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.bookedVerified}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-600">
                      {pct(r.verifiedRate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Ranked by calls placed. Verified bookings are confirmed by a manager in the
        Booked meetings queue.
      </p>
    </main>
  );
}
