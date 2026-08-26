import type { SheetRow } from "@/lib/sheets";
import { apiGuard } from "@/lib/auth/guards";
import { getConsoleSheetUrl } from "@/lib/settings";
import {
  appendRows,
  verifyAccess,
  serviceAccountEmail,
  SheetsError,
} from "@/lib/sheets-server";

// Talks to Google with server-held credentials; never cache or prerender.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body =
  | { action: "ping"; sheetUrl?: string }
  | { action: "sync"; sheetUrl?: string; rows?: SheetRow[] }
  | { action: "syncDefault"; rows?: SheetRow[] };

/**
 * Single endpoint for the Google Sheet sync panel.
 *  - { action: "ping" }         → verify the server can read the pasted Sheet.
 *  - { action: "sync" }         → append rows to the pasted Sheet (de-duped by id).
 *  - { action: "syncDefault" }  → append rows to the admin-configured call-log
 *                                 Sheet (Settings → Connections). The URL stays
 *                                 server-side — the client never sees it. Used by
 *                                 solo-mode calls so both modes land in one sheet.
 *
 * Errors are returned as friendly messages the panel shows verbatim, plus the
 * service-account address so the user knows exactly whom to share the Sheet with.
 */
export async function POST(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  // Append to the admin-configured call-log sheet (URL held server-side).
  // Silently a no-op (configured:false) when no sheet is set, so the caller can
  // fall back to its own mechanism without treating it as an error.
  if (body.action === "syncDefault") {
    const url = await getConsoleSheetUrl();
    if (!url) return Response.json({ ok: true, configured: false, syncedIds: [] });
    const rows = Array.isArray(body.rows) ? body.rows : [];
    try {
      const syncedIds = await appendRows(url, rows);
      return Response.json({ ok: true, configured: true, syncedIds });
    } catch (err) {
      if (err instanceof SheetsError) {
        return Response.json({ ok: false, configured: true, error: err.message }, { status: 500 });
      }
      return Response.json(
        { ok: false, configured: true, error: "Unexpected error syncing to Google Sheets." },
        { status: 500 },
      );
    }
  }

  const sheetUrl = body.sheetUrl?.trim();
  if (!sheetUrl) {
    return Response.json(
      { ok: false, error: "Paste your Google Sheet link first." },
      { status: 400 },
    );
  }

  try {
    if (body.action === "ping") {
      await verifyAccess(sheetUrl);
      return Response.json({ ok: true, serviceAccountEmail: serviceAccountEmail() });
    }

    if (body.action === "sync") {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const syncedIds = await appendRows(sheetUrl, rows);
      return Response.json({ ok: true, syncedIds });
    }

    return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (err) {
    if (err instanceof SheetsError) {
      const status =
        err.code === "not_configured" || err.code === "auth_failed" ? 500 : 400;
      return Response.json(
        { ok: false, error: err.message, serviceAccountEmail: serviceAccountEmail() },
        { status },
      );
    }
    return Response.json(
      { ok: false, error: "Unexpected error syncing to Google Sheets." },
      { status: 500 },
    );
  }
}
