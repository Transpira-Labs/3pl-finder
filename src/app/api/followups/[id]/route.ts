import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { followUps } from "@/db/schema";
import { completeFollowUp, snoozeFollowUp } from "@/lib/pipeline/service";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

// Body is one of two shapes: mark done/canceled, or snooze to a new due time.
const bodySchema = z.union([
  z.object({
    status: z.enum(["done", "canceled"]),
    repId: z.string().optional(),
  }),
  z.object({ dueAt: z.string().datetime() }),
]);

/** PATCH /api/followups/[id] — complete/cancel a follow-up, or snooze its due time. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "invalid", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // The service helpers throw on a missing id; pre-check so we return a clean 404.
  const [existing] = await db
    .select()
    .from(followUps)
    .where(eq(followUps.id, id));
  if (!existing) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const followUp =
    "status" in parsed.data
      ? await completeFollowUp(id, {
          status: parsed.data.status,
          repId: parsed.data.repId,
        })
      : await snoozeFollowUp(id, new Date(parsed.data.dueAt));

  return Response.json({ followUp });
}
