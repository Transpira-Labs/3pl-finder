import { z } from "zod";
import { readStaged } from "@/lib/ingestion/store";
import { validateBatch } from "@/lib/ingestion/service";
import type { ColumnMapping } from "@/lib/ingestion/types";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string(),
  mapping: z.object({
    phone: z.string().min(1),
    name: z.string().optional(),
    company: z.string().optional(),
    timezone: z.string().optional(),
    source: z.string().optional(),
    consentBasis: z.string().min(1),
    notes: z.string().optional(),
  }),
});

/**
 * Step 2 — Validate & build the pre-import report.
 * Runs every staged row through the shared gate with the chosen mapping and
 * returns the summary counts + a sample of rows. Nothing is committed here; no
 * row becomes dial-eligible until the user confirms and calls /commit.
 */
export async function POST(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const staged = await readStaged(parsed.data.token);
  if (!staged) {
    return Response.json(
      { error: "upload expired or not found; please re-upload" },
      { status: 404 },
    );
  }

  const validated = await validateBatch(
    staged.rows,
    parsed.data.mapping as ColumnMapping,
  );

  // Return the summary plus a capped sample so a 100k-row report stays light.
  const SAMPLE = 200;
  return Response.json({
    filename: staged.filename,
    summary: validated.summary,
    sample: validated.rows.slice(0, SAMPLE).map((r) => ({
      rowIndex: r.rowIndex,
      name: r.name,
      company: r.company,
      phone: r.phoneE164,
      timezone: r.timezone,
      consentBasis: r.consentBasis,
      status: r.status,
      reason: r.reason,
    })),
    sampleTruncated: validated.rows.length > SAMPLE,
  });
}
