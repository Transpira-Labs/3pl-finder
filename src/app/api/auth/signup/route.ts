import { createUser, getUserByEmail } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

/** Open self-signup. New accounts get role "none" until an admin assigns one. */
export async function POST(request: Request) {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = (body.email ?? "").toLowerCase().trim();
  const password = body.password ?? "";
  const name = (body.name ?? "").trim() || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (await getUserByEmail(email)) {
    return Response.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  await createUser({ email, password, name });
  return Response.json({ ok: true });
}
