import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { dailyNotes } from "@/db/schema";
import { getSetting, setSetting, SETTINGS_KEYS } from "@/lib/settings";
import { dayStats, localDay, type DayStats } from "./stats";

/**
 * Call Analytics: the day's numbers plus the journal entry that explains them.
 *
 * Everything here is SQL. There is no model in this path — a day's figures are
 * computed on read, so the page is always current and costs nothing to open.
 *
 * The journal is what makes the numbers actionable: you record what you did
 * differently on a given day and tag it, and the trend view compares days
 * carrying a tag against days without it. That comparison is ordinary
 * arithmetic over the same call data.
 */

export const DEFAULT_TIMEZONE = "America/New_York";

export async function reportingTimezone(): Promise<string> {
  return (await getSetting(SETTINGS_KEYS.analyticsTimezone))?.trim() || DEFAULT_TIMEZONE;
}

export async function setReportingTimezone(tz: string): Promise<void> {
  await setSetting(SETTINGS_KEYS.analyticsTimezone, tz.trim() || null);
}

/** Today's date in the reporting timezone — the default day to show. */
export async function currentDay(): Promise<string> {
  return localDay(new Date(), await reportingTimezone());
}

/** Every tag used so far, for the picker and to keep labels consistent. */
export async function knownTags(): Promise<string[]> {
  const rows = await db.select({ tags: dailyNotes.tags }).from(dailyNotes);
  return [...new Set(rows.flatMap((r) => r.tags ?? []))].sort();
}

export type DailyPayload = {
  day: string;
  timezone: string;
  stats: DayStats;
  knownTags: string[];
};

export async function getDaily(
  day: string,
  repId?: string | null,
): Promise<DailyPayload> {
  const tz = await reportingTimezone();
  const [stats, tags] = await Promise.all([dayStats(day, tz, repId), knownTags()]);
  return { day, timezone: tz, stats, knownTags: tags };
}

/** Upsert the day's journal entry. Empty note removes it. */
export async function saveNote(
  day: string,
  note: string,
  userId: string | null,
): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) {
    await db.delete(dailyNotes).where(eq(dailyNotes.day, day));
    return;
  }
  const values = { day, note: trimmed, createdBy: userId, updatedAt: new Date() };
  await db
    .insert(dailyNotes)
    .values(values)
    .onConflictDoUpdate({
      target: dailyNotes.day,
      // Leave tags alone — they're edited separately.
      set: { note: values.note, updatedAt: values.updatedAt },
    });
}

/**
 * Set the tags on a day. Normalized to kebab-case so "New Opener" and
 * "new-opener" land in the same cohort instead of splitting it.
 */
export async function setTags(day: string, tags: string[]): Promise<void> {
  const normalized = [
    ...new Set(
      tags
        .map((t) =>
          t
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
        )
        .filter(Boolean),
    ),
  ];

  // A tag needs a note to hang off, so create a placeholder if there isn't one.
  const existing = await db
    .select({ id: dailyNotes.id })
    .from(dailyNotes)
    .where(eq(dailyNotes.day, day))
    .limit(1);

  if (existing.length === 0) {
    if (normalized.length === 0) return;
    await db.insert(dailyNotes).values({ day, note: "", tags: normalized });
    return;
  }

  await db
    .update(dailyNotes)
    .set({ tags: normalized, updatedAt: new Date() })
    .where(eq(dailyNotes.day, day));
}

/** Days that have a journal entry, newest first. */
export async function recentNotes(limit = 60) {
  return db.select().from(dailyNotes).orderBy(desc(dailyNotes.day)).limit(limit);
}
