import { parseLeadFile } from "@/lib/ingestion/parse";
import { stageUpload } from "@/lib/ingestion/store";
import { autoSuggestMapping, getMappingTemplate } from "@/lib/ingestion/service";
import { apiGuard } from "@/lib/auth/guards";

// Ingestion is inherently dynamic + writes temp files; never prerender/cache.
export const dynamic = "force-dynamic";

/**
 * Step 1 — Upload & detect columns.
 * Accepts a multipart file, stream-parses it, stages the parsed rows, and returns
 * the detected headers plus a suggested column mapping (saved vendor template if
 * one exists, otherwise a heuristic guess). Never assumes headers.
 */
export async function POST(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const form = await request.formData();
  const file = form.get("file");
  const vendor = (form.get("vendor") as string | null)?.trim() || null;

  if (!(file instanceof File)) {
    return Response.json({ error: "no file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseLeadFile(buffer, file.name);
  } catch (err) {
    return Response.json(
      { error: `could not parse file: ${(err as Error).message}` },
      { status: 422 },
    );
  }

  if (parsed.headers.length === 0) {
    return Response.json({ error: "file has no columns" }, { status: 422 });
  }

  const token = await stageUpload({
    filename: file.name,
    headers: parsed.headers,
    rows: parsed.rows,
  });

  const savedTemplate = vendor ? await getMappingTemplate(vendor) : null;
  const suggestedMapping = savedTemplate ?? autoSuggestMapping(parsed.headers);

  return Response.json({
    token,
    filename: file.name,
    headers: parsed.headers,
    rowCount: parsed.rows.length,
    suggestedMapping,
    usedSavedTemplate: Boolean(savedTemplate),
  });
}
