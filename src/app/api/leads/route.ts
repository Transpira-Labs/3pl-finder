import { z } from "zod";
import { listPipelineLeads, pipelineSummary } from "@/lib/pipeline/service";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const stageEnum = z.enum([
  "new",
  "contacted",
  "follow_up",
  "qualified",
  "won",
  "lost",
  "do_not_contact",
]);

const querySchema = z.object({
  stage: stageEnum.optional(),
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/leads — paginated pipeline list + per-stage/due-now summary badges. */
export async function GET(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const sp = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    stage: sp.get("stage") ?? undefined,
    q: sp.get("q") ?? undefined,
    limit: sp.get("limit") ?? undefined,
    offset: sp.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "invalid", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [{ leads, total }, summary] = await Promise.all([
    listPipelineLeads(parsed.data),
    pipelineSummary(),
  ]);
  return Response.json({ leads, total, summary });
}
