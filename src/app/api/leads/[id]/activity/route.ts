import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { logOutcome } from "@/lib/pipeline/service";
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

const bodySchema = z.object({
  kind: z.enum(["outcome", "note"]),
  templateKey: z.string().optional(),
  body: z.string().min(1),
  repId: z.string().optional(),
  callAttemptId: z.string().optional(),
  stage: stageEnum.optional(),
  followUp: z
    .object({
      channel: z.enum(["call", "email"]),
      dueAt: z.string().datetime(),
      note: z.string().optional(),
    })
    .optional(),
});

/**
 * POST /api/leads/[id]/activity — log a call outcome or a free-text note.
 * Runs through the pipeline service (one transaction: activity + stage/disposition
 * + optional follow-up + do_not_call opt-out).
 */
export async function POST(
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

  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // The service takes a Date for the follow-up due time; the API accepts an ISO
  // string. Convert on the way in and forward everything else unchanged.
  const { followUp, ...rest } = parsed.data;
  const result = await logOutcome(id, {
    ...rest,
    followUp: followUp
      ? {
          channel: followUp.channel,
          dueAt: new Date(followUp.dueAt),
          note: followUp.note,
        }
      : undefined,
  });
  return Response.json(result);
}
