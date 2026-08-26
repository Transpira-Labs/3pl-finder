import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "./password";

export type UserRole = "none" | "rep" | "admin";

export async function getUserByEmail(email: string) {
  return (
    await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()))
  )[0];
}

export async function getUserById(id: string) {
  return (await db.select().from(users).where(eq(users.id, id)))[0];
}

/** Create a new account. New signups get role "none" until an admin assigns one. */
export async function createUser(input: {
  email: string;
  password: string;
  name?: string | null;
  role?: UserRole;
}) {
  const [u] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase().trim(),
      name: input.name ?? null,
      passwordHash: hashPassword(input.password),
      role: input.role ?? "none",
    })
    .returning();
  return u;
}

export async function listUsers() {
  return db.select().from(users).orderBy(users.createdAt);
}

/** Admin action: set a user's role and optional linked rep (dialer identity). */
export async function setUserRole(id: string, role: UserRole, repId?: string | null) {
  const [u] = await db
    .update(users)
    .set({ role, ...(repId !== undefined ? { repId } : {}) })
    .where(eq(users.id, id))
    .returning();
  return u;
}

/** Live role from the DB — used by API guards so role changes take effect even
 *  if a session JWT is stale. */
export async function getLiveRole(id: string): Promise<UserRole | null> {
  const u = await getUserById(id);
  return (u?.role as UserRole) ?? null;
}

/** How many admins exist. Zero ⇒ the system needs first-admin bootstrap. */
export async function countAdmins(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.role, "admin"));
  return Number(row?.n ?? 0);
}
