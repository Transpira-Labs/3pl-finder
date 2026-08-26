/**
 * Shared guard for the scheduled routes under /api/cron.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on every cron invocation
 * when CRON_SECRET is set on the project. These routes write to the database and
 * call out to Google and Anthropic, so an unauthenticated URL would let anyone on
 * the internet trigger imports at will.
 *
 * If CRON_SECRET is unset the route refuses rather than running open: failing
 * closed turns a misconfiguration into an obvious 503 instead of a silent hole.
 * Locally you don't need it — run `npm run ingest`, or open a day in Call
 * Analytics, both of which call the same code directly.
 */
export function assertCron(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured; scheduled routes are disabled." },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
