import { auth } from "@/auth";
import { countAdmins, setUserRole } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * First-admin bootstrap — replaces the terminal `npm run make-admin`. New signups
 * default to role "none"; someone has to become the first admin without an admin
 * existing yet. This endpoint lets ANY signed-in user claim admin, but ONLY while
 * zero admins exist. Once the first admin is set, it refuses — further roles are
 * assigned from Settings → Team.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ needsBootstrap: (await countAdmins()) === 0 });
}

export async function POST() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if ((await countAdmins()) > 0) {
    return Response.json({ error: "An admin already exists." }, { status: 409 });
  }
  await setUserRole(session.user.id, "admin");
  return Response.json({ ok: true });
}
