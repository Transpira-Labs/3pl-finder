import { z } from "zod";
import { apiGuard } from "@/lib/auth/guards";
import { setBookingVerified } from "@/lib/analytics/bookings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  callId: z.string().uuid(),
  verified: z.boolean(),
});

/** Managers verify (or un-verify) a rep's booked-meeting claim. Admin only. */
export async function POST(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await setBookingVerified(parsed.data.callId, parsed.data.verified, guard.userId);
  return Response.json({ ok: true });
}
