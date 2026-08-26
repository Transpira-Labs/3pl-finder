import { z } from "zod";
import { apiGuard } from "@/lib/auth/guards";
import { repIdForUser } from "@/lib/auth/rep";
import { getDaily, saveNote, setTags, currentDay, recentNotes } from "@/lib/analytics/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** One day's call statistics plus its journal entry. Pure SQL — always current. */
export async function GET(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const url = new URL(request.url);
  const day = url.searchParams.get("day") ?? (await currentDay());
  if (!DAY.test(day)) {
    return Response.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  }

  // Reps only ever see their own numbers; managers see everyone unless they ask
  // to scope to just themselves. The repId is resolved server-side from the
  // session — never read from the request — so a rep can't widen their own view.
  const scoped = guard.role === "rep" || url.searchParams.get("scope") === "me";
  const repId = scoped ? await repIdForUser(guard.userId) : null;

  const payload = await getDaily(day, repId);
  return Response.json({ ...payload, notedDays: await recentNotes(), scoped });
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("saveNote"),
    day: z.string().regex(DAY),
    note: z.string().max(4000),
  }),
  z.object({
    action: z.literal("setTags"),
    day: z.string().regex(DAY),
    tags: z.array(z.string().max(64)).max(12),
  }),
]);

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
  const b = parsed.data;

  if (b.action === "saveNote") await saveNote(b.day, b.note, guard.userId);
  else await setTags(b.day, b.tags);

  return Response.json(await getDaily(b.day));
}
