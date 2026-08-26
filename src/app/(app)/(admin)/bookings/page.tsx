import { BookingsTable } from "@/components/analytics/bookings-table";
import { listBookedMeetings } from "@/lib/analytics/bookings";
import { reportingTimezone } from "@/lib/analytics/service";

export const dynamic = "force-dynamic";

/**
 * Booked meetings — the manager verification queue. Every call a rep dispositioned
 * "Booked meeting" lands here; a manager checks off the ones that actually landed
 * on the calendar. The leaderboard reads the same flag (claimed vs verified).
 *
 * Admin-only by virtue of living under the (admin) route group.
 */
export default async function BookingsPage() {
  const [meetings, tz] = await Promise.all([
    listBookedMeetings(),
    reportingTimezone(),
  ]);
  const verified = meetings.filter((m) => m.verified).length;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-6">
        <p className="eyebrow">Admin</p>
        <h1 className="font-display mt-1 text-2xl">Booked meetings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every call a rep marked &ldquo;Booked meeting&rdquo;. Check the ones you
          have confirmed actually landed — the leaderboard tracks verified against
          claimed. {verified} of {meetings.length} verified.
        </p>
      </header>
      <BookingsTable
        timezone={tz}
        rows={meetings.map((m) => ({
          id: m.id,
          startedAt: m.startedAt.toISOString(),
          phone: m.phone,
          repName: m.repName,
          leadName: m.leadName,
          company: m.company,
          repNote: m.repNote,
          verified: m.verified,
          verifiedByName: m.verifiedByName,
        }))}
      />
    </main>
  );
}
