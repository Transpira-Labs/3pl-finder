import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { getLeadDetail, setStage } from "@/lib/pipeline/service";
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

/** GET /api/leads/[id] — lead + activity timeline + follow-ups + call summaries. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const detail = await getLeadDetail(id);
  if (!detail || !detail.lead) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json(detail);
}

const patchSchema = z
  .object({
    pipelineStage: stageEnum.optional(),
    // Capture/correct a contact email (e.g. a rep types it in mid-call). Accepts
    // a valid address, or "" / null to clear it.
    email: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  })
  .refine((v) => v.pipelineStage !== undefined || v.email !== undefined, {
    message: "nothing to update",
  });

/** DELETE /api/leads/[id] — remove a lead from the pipeline. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const [existing] = await db.select().from(leads).where(eq(leads.id, id));
  if (!existing) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  await db.delete(leads).where(eq(leads.id, id));
  return Response.json({ success: true });
}

/** PATCH /api/leads/[id] — update a lead's pipeline stage and/or contact email. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "invalid", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [existing] = await db.select().from(leads).where(eq(leads.id, id));
  if (!existing) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // Email update (independent of stage): normalize "" → null.
  if (parsed.data.email !== undefined) {
    const email = parsed.data.email ? parsed.data.email.trim() : null;
    await db.update(leads).set({ email }).where(eq(leads.id, id));
  }

  // Stage change goes through setStage (writes its own timeline entry).
  const lead = parsed.data.pipelineStage
    ? await setStage(id, parsed.data.pipelineStage, {})
    : (await db.select().from(leads).where(eq(leads.id, id)))[0];

  return Response.json({ lead });
}
