import { apiGuard } from "@/lib/auth/guards";
import { setBrowserPresence } from "@/lib/campaigns/service";

export const dynamic = "force-dynamic";

/**
 * Browser-rep presence heartbeat. The softphone POSTs this on a timer while it's
 * registered (online: true) and once on teardown (online: false). Presence /
 * availability follows this — a logged-in rep with a live softphone is available.
 */
export async function POST(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const body = (await request.json().catch(() => ({}))) as { online?: boolean };
  await setBrowserPresence(guard.userId, body.online !== false);
  return Response.json({ ok: true });
}
