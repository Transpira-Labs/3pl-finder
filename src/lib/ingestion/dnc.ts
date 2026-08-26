import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { suppressionList } from "@/db/schema";

export type DncResult = "clear" | "listed";

/**
 * DncScrubber — the seam for National + state DNC registry checks.
 *
 * IMPORTANT (see IMPLEMENTATION_PLAN.md §0.5): DNC scrubbing applies to
 * live-human cold calls too — the "no synthesized voice" design does NOT exempt
 * you from the registry. A real provider (subscription + per-lookup, 💲) must be
 * wired here before any live campaign. Until then the stub returns "clear" for
 * the external registries; the INTERNAL suppression list below is real and
 * always enforced.
 */
export interface DncScrubber {
  /** Returns a map of E.164 → result for the external (National/state) lists. */
  scrub(phones: string[]): Promise<Map<string, DncResult>>;
}

/** No-op stub: treats every number as clear on the external registries. */
export class StubDncScrubber implements DncScrubber {
  async scrub(phones: string[]): Promise<Map<string, DncResult>> {
    const result = new Map<string, DncResult>();
    for (const p of phones) result.set(p, "clear");
    return result;
  }
}

export function getDncScrubber(): DncScrubber {
  // Only the stub exists today; switch on DNC_PROVIDER when a real one is added.
  return new StubDncScrubber();
}

/**
 * Look up the internal suppression / opt-out list (this is real, not stubbed).
 * Returns the set of provided phones that are suppressed.
 */
export async function checkInternalSuppression(
  phones: string[],
): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const rows = await db
    .select({ phone: suppressionList.phone })
    .from(suppressionList)
    .where(inArray(suppressionList.phone, phones));
  return new Set(rows.map((r) => r.phone));
}
