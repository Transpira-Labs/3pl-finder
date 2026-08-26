import { z } from "zod";
import { apiGuard } from "@/lib/auth/guards";
import { dayStats } from "@/lib/analytics/stats";
import { reportingTimezone } from "@/lib/analytics/service";
import { exportDayTab } from "@/lib/analytics/sheet-export";
import { getConsoleSheetUrl } from "@/lib/settings";
import { SheetsError, serviceAccountEmail } from "@/lib/sheets-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("exportDay"), day: z.string().regex(DAY) }),
]);

/**
 * Write one day's analytics to its own tab of the call-log Sheet.
 *
 * Deliberately separate from /api/analytics/daily: that route's POST answers
 * every action with the day's full payload and the panel does `setData(r)` on
 * the result, so an export returning a different shape would corrupt its state.
 *
 * Errors come back as messages the panel shows verbatim, with the service
 * account address attached so "share the sheet with…" is actionable.
 */
export async function POST(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const sheetUrl = await getConsoleSheetUrl();
  if (!sheetUrl) {
    return Response.json(
      {
        ok: false,
        error:
          "No call-log sheet is configured. Set one in Settings → Connections, then export again.",
      },
      { status: 400 },
    );
  }

  try {
    const tz = await reportingTimezone();
    const stats = await dayStats(parsed.data.day, tz);
    const { tab, url } = await exportDayTab(sheetUrl, stats);
    return Response.json({ ok: true, tab, url });
  } catch (err) {
    if (err instanceof SheetsError) {
      const status =
        err.code === "not_configured" || err.code === "auth_failed" ? 500 : 400;
      return Response.json(
        { ok: false, error: err.message, serviceAccountEmail: serviceAccountEmail() },
        { status },
      );
    }
    console.error("[analytics/export] failed:", err);
    return Response.json(
      { ok: false, error: "Unexpected error writing to Google Sheets." },
      { status: 500 },
    );
  }
}
