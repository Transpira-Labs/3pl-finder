import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLiveRole, type UserRole } from "./users";

/** Home route for a role (where to send someone who lacks access to a page). */
export function homeFor(role: UserRole): string {
  if (role === "admin") return "/dashboard";
  if (role === "rep") return "/console";
  return "/no-access";
}

/** Page guard: require a session; returns { session, role } with the LIVE role
 *  (re-read from the DB so an admin's role change takes effect immediately). */
export async function requirePage(roles: UserRole[]) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (await getLiveRole(session.user.id)) ?? "none";
  if (role === "none") redirect("/no-access");
  if (!roles.includes(role)) redirect(homeFor(role));
  return { session, role };
}

/** Like requirePage but only requires being signed in (any assigned role). */
export async function requireSignedIn() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (await getLiveRole(session.user.id)) ?? "none";
  return { session, role };
}

/** Set to true to require login. False = skip auth entirely. */
const REQUIRE_LOGIN = false;

/** API guard: returns the session or a Response to return early. */
export async function apiGuard(
  roles: UserRole[],
): Promise<
  | { ok: true; userId: string; role: UserRole }
  | { ok: false; res: Response }
> {
  if (!REQUIRE_LOGIN) {
    return { ok: true, userId: "dev-user", role: "admin" };
  }
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const role = (await getLiveRole(session.user.id)) ?? "none";
  if (!roles.includes(role)) {
    return { ok: false, res: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, userId: session.user.id, role };
}
