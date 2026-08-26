import { z } from "zod";
import { apiGuard } from "@/lib/auth/guards";
import {
  getSaleshandyConfig,
  setSaleshandyConfig,
  setSaleshandyRoutes,
  resetSaleshandyWatermark,
} from "@/lib/settings";
import { saleshandyConfigured, listTags, verifyKey } from "@/lib/saleshandy/client";
import {
  importSaleshandyProspects,
  getLastImportReport,
} from "@/lib/ingestion/saleshandy-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full re-walk pages through the whole prospect history; give it room.
export const maxDuration = 300;

/**
 * Saleshandy lead source (admin).
 *  - GET  → whether the key is wired, the non-secret config, and available tags.
 *  - POST → { action: save | import | verify | reset }.
 *
 * The scheduled ingest pass pulls on its own loop; "import" runs one pull now.
 * The API key itself lives in env (SALESHANDY_API_KEY) and is never returned
 * here — same posture as the Twilio credentials.
 */

async function state() {
  const configured = saleshandyConfigured();
  const config = await getSaleshandyConfig();
  let tags: string[] = [];
  if (configured) {
    // Best-effort: a bad key shouldn't turn the whole panel into an error page.
    tags = await listTags().catch(() => []);
  }
  // The itemised result of the last import, so "11 imported / 54 skipped" can be
  // opened up into names instead of being a number the user has to take on faith.
  const report = await getLastImportReport().catch(() => null);
  return { configured, config, tags, report };
}

export async function GET() {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;
  return Response.json(await state());
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    campaignId: z.string().uuid().nullable().optional(),
    tag: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal("setRoutes"),
    routes: z.array(
      z.object({ tag: z.string().min(1), campaignId: z.string().uuid() }),
    ),
  }),
  z.object({ action: z.literal("import"), full: z.boolean().optional() }),
  z.object({ action: z.literal("verify") }),
  z.object({ action: z.literal("reset") }),
]);

export async function POST(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  if (b.action !== "save" && !saleshandyConfigured()) {
    return Response.json(
      { error: "SALESHANDY_API_KEY is not set on this deployment." },
      { status: 400 },
    );
  }

  try {
    if (b.action === "save") {
      const patch: { campaignId?: string | null; tag?: string | null } = {};
      if ("campaignId" in b) patch.campaignId = b.campaignId ?? null;
      if ("tag" in b) patch.tag = b.tag ?? null;
      await setSaleshandyConfig(patch);
    } else if (b.action === "setRoutes") {
      await setSaleshandyRoutes(b.routes);
    } else if (b.action === "verify") {
      return Response.json({ ...(await state()), verify: await verifyKey() });
    } else if (b.action === "reset") {
      // Re-opens the whole history to the next pass. Safe: the contact ledger
      // still blocks any number we've already imported.
      await resetSaleshandyWatermark();
    } else if (b.action === "import") {
      const result = await importSaleshandyProspects({
        uploadedBy: guard.userId,
        full: b.full,
      });
      return Response.json({ ok: true, ...(await state()), result });
    }
    return Response.json({ ok: true, ...(await state()) });
  } catch (e) {
    console.error("[saleshandy] failed:", e);
    return Response.json({ error: (e as Error)?.message ?? "failed" }, { status: 500 });
  }
}
