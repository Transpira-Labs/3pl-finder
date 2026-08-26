import { z } from "zod";
import { listFollowUps } from "@/lib/pipeline/service";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["pending", "done", "canceled"]).default("pending"),
  due: z.enum(["now", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/followups — the due queue, joined with a lead summary. */
export async function GET(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const sp = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    status: sp.get("status") ?? undefined,
    due: sp.get("due") ?? undefined,
    limit: sp.get("limit") ?? undefined,
    offset: sp.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "invalid", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { status, due, limit, offset } = parsed.data;
  const { followUps, total } = await listFollowUps({
    status,
    dueOnly: due === "now",
    limit,
    offset,
  });
  return Response.json({ followUps, total });
}
