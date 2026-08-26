import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts } from "@/db/schema";
import { sessionRep } from "@/lib/queue/session-rep";
import { setRepOnCall } from "@/lib/campaigns/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ attemptId: z.string().uuid() });

/**
 * The softphone failed to connect after the call was authorized — close the
 * attempt and free the rep.
 *
 * Without this, a browser-side connect failure would leave the rep flagged
 * on-call forever (nothing else clears it, since /api/voice/status only fires
 * for calls Twilio actually placed) and leave an attempt row open. The lead is
 * untouched: the ledger is only written at dial-release, so it stays callable.
 */
export async function POST(request: Request) {
  const s = await sessionRep();
  if (!s.ok) return s.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "attemptId is required" }, { status: 400 });
  }

  // Scoped to this rep's own still-open attempt, so one rep can't close another's.
  await db
    .update(callAttempts)
    .set({ finalState: "DEAD", endedAt: new Date() })
    .where(
      and(
        eq(callAttempts.id, parsed.data.attemptId),
        eq(callAttempts.repId, s.rep.id),
        isNull(callAttempts.endedAt),
      ),
    );
  await setRepOnCall(s.rep.id, false);

  return Response.json({ ok: true });
}
