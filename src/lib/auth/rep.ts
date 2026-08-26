import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reps } from "@/db/schema";

/**
 * The repId (the id that lands in `call_attempts.rep_id`) for a logged-in user.
 *
 * `reps.userId` is the authoritative link and is unique, so this is the safe way
 * to scope analytics to "my calls" — `session.user.repId` is a convenience copy
 * that can be null or stale. Returns null when the user has no rep row yet (they
 * have never opened the console / placed a call), which correctly scopes to an
 * empty result set rather than leaking anyone else's numbers.
 */
export async function repIdForUser(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: reps.id })
    .from(reps)
    .where(eq(reps.userId, userId))
    .limit(1);
  return row?.id ?? null;
}
