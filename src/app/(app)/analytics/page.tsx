import { AnalyticsPanel } from "@/components/analytics/analytics-panel";
import { requirePage } from "@/lib/auth/guards";
import { currentDay, reportingTimezone } from "@/lib/analytics/service";

export const dynamic = "force-dynamic";

/**
 * Call Analytics — a daily read of what the calling actually produced.
 *
 * Every figure is computed in SQL on read, so the page is always current and
 * costs nothing to open. Role-scoped: a rep sees only their own calls; a manager
 * sees everyone, with a "Just me" toggle. The scoping is enforced in the API
 * (repId resolved from the session), not just hidden here.
 */
export default async function AnalyticsPage() {
  const { role } = await requirePage(["rep", "admin"]);
  // Resolve "today" server-side so the day defaults to the reporting timezone
  // rather than whatever the user's browser happens to be set to.
  const [day, tz] = await Promise.all([currentDay(), reportingTimezone()]);
  const isManager = role === "admin";

  return (
    <main className="mx-auto max-w-6xl p-8">
      <header className="mb-6">
        <p className="eyebrow">{isManager ? "Admin" : "You"}</p>
        <h1 className="font-display mt-1 text-2xl">
          {isManager ? "Call analytics" : "Your call analytics"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isManager ? (
            <>
              What each calling day produced, and how it compares. Note what you
              did differently and tag it — days sharing a tag get measured against
              the rest. Days start in {tz}.
            </>
          ) : (
            <>
              What your calling days produced, and how they compare. Days start in{" "}
              {tz}.
            </>
          )}
        </p>
      </header>
      <AnalyticsPanel initialDay={day} role={role} />
    </main>
  );
}
