import { z } from "zod";
import {
  assignRepToCampaign,
  unassignRepFromCampaign,
  listCallableUsers,
  setRepPresence,
} from "@/lib/campaigns/service";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/**
 * Reps on a campaign.
 *
 * Reps are platform users, not hand-entered records: anyone with role `rep` or
 * `admin` is a rep, and this endpoint only decides which campaigns they work.
 * The old POST that created a rep from a name + phone number is gone — those
 * rows had no user account, so they could never sign in or take a softphone
 * call. A rep can be assigned to several campaigns and draws leads from all.
 *
 *  - GET    → every callable user, with the campaigns they're assigned to.
 *  - POST   → { userId } assign to this campaign (creates their rep row if needed).
 *  - DELETE → { userId } unassign. Their rep row and call history are untouched.
 *  - PATCH  → presence toggle.
 */

export async function GET() {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;
  return Response.json({ users: await listCallableUsers() });
}

const userSchema = z.object({ userId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const parsed = userSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }
  try {
    await assignRepToCampaign(parsed.data.userId, id);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  return Response.json({ ok: true, users: await listCallableUsers() });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const parsed = userSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }
  await unassignRepFromCampaign(parsed.data.userId, id);
  return Response.json({ ok: true, users: await listCallableUsers() });
}

const patchSchema = z.object({
  repId: z.string(),
  presence: z.enum(["available", "away"]),
});

/** Toggle rep presence — who is at their desk and able to take a lead. */
export async function PATCH(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  await setRepPresence(parsed.data.repId, parsed.data.presence);
  return Response.json({ ok: true });
}
