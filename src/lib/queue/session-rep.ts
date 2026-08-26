import { apiGuard } from "@/lib/auth/guards";
import { getUserById } from "@/lib/auth/users";
import { ensureBrowserRep } from "@/lib/campaigns/service";

type Rep = Awaited<ReturnType<typeof ensureBrowserRep>>;

/**
 * Resolve the calling identity for a queue/voice request: the signed-in user's
 * own browser (softphone) rep, created on first use.
 *
 * Deliberately not taken from the request body — a rep id in a payload would let
 * one rep claim leads, or place calls, as another. The console's rep picker only
 * chooses whose *stopwatch history* is shown; who may dial is always the session.
 */
export async function sessionRep(): Promise<
  { ok: true; rep: Rep; userId: string } | { ok: false; res: Response }
> {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return { ok: false, res: guard.res };

  const user = await getUserById(guard.userId);
  const rep = await ensureBrowserRep(
    guard.userId,
    user?.name ?? user?.email ?? "Rep",
  );
  if (!rep) {
    return {
      ok: false,
      res: Response.json({ error: "no rep identity" }, { status: 500 }),
    };
  }
  return { ok: true, rep, userId: guard.userId };
}
