import { apiGuard } from "@/lib/auth/guards";
import { listUsers, setUserRole, type UserRole } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

const ROLES: UserRole[] = ["none", "rep", "admin"];

// ── GET: list all users (admin only) ─────────────────────────────────────────
export async function GET() {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const rows = await listUsers();
  return Response.json({
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      repId: u.repId,
      createdAt: u.createdAt.toISOString(),
    })),
  });
}

// ── PATCH: change a user's role (admin only) ─────────────────────────────────
export async function PATCH(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const body = (await request.json().catch(() => ({}))) as {
    userId?: string;
    role?: string;
    repId?: string | null;
  };
  if (!body.userId || !body.role || !ROLES.includes(body.role as UserRole)) {
    return Response.json({ error: "userId and a valid role are required" }, { status: 400 });
  }
  // Don't let an admin strip their own admin role and lock themselves out.
  if (body.userId === guard.userId && body.role !== "admin") {
    return Response.json({ error: "You can't change your own admin role." }, { status: 400 });
  }

  const updated = await setUserRole(body.userId, body.role as UserRole, body.repId ?? undefined);
  return Response.json({ ok: true, user: { id: updated.id, role: updated.role } });
}
