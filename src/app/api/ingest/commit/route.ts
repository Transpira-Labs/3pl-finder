import { z } from "zod";
import { readStaged, discardStaged } from "@/lib/ingestion/store";
import {
  validateBatch,
  commitBatch,
  saveMappingTemplate,
} from "@/lib/ingestion/service";
import type { ColumnMapping } from "@/lib/ingestion/types";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string(),
  vendor: z.string().optional(),
  mapping: z.object({
    phone: z.string().min(1),
    name: z.string().optional(),
    company: z.string().optional(),
    website: z.string().optional(),
    timezone: z.string().optional(),
    source: z.string().optional(),
    consentBasis: z.string().min(1),
    notes: z.string().optional(),
  }),
});

/**
 * Step 3 — Commit after the user confirms the report.
 * Re-runs the gate (source of truth is always the gate, never client-supplied
 * counts), persists every row with its outcome, saves the vendor mapping
 * template, and discards the staged upload. Only `eligible` rows are dial-eligible.
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

  const { token, vendor, mapping } = parsed.data;
  const staged = await readStaged(token);
  if (!staged) {
    return Response.json(
      { error: "upload expired or not found; please re-upload" },
      { status: 404 },
    );
  }

  const validated = await validateBatch(staged.rows, mapping as ColumnMapping);
  const batchId = await commitBatch({
    filename: staged.filename,
    mapping: mapping as ColumnMapping,
    validated,
  });

  if (vendor?.trim()) {
    await saveMappingTemplate(vendor.trim(), mapping as ColumnMapping);
  }
  await discardStaged(token);

  return Response.json({ batchId, summary: validated.summary });
}
