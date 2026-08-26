import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts, leads, reps, users } from "@/db/schema";

/**
 * Booked-meeting verification.
 *
 * A rep dispositioning a call "booked" is a claim. This is the manager's queue to
 * confirm the meeting actually landed — a single verified checkmark per call. The
 * leaderboard reads the same flag to show claimed vs confirmed booking rates.
 */

export type BookedMeeting = {
  id: string;
  startedAt: Date;
  phone: string;
  repId: string | null;
  repName: string | null;
  leadName: string | null;
  company: string | null;
  repNote: string | null;
  verified: boolean;
  verifiedAt: Date | null;
  verifiedByName: string | null;
};

/**
 * Every call dispositioned "booked meeting", newest first — the verification
 * queue. Joined to the rep who booked it and the lead it was for.
 */
export async function listBookedMeetings(limit = 500): Promise<BookedMeeting[]> {
  const rows = await db
    .select({
      id: callAttempts.id,
      startedAt: callAttempts.startedAt,
      phone: callAttempts.phone,
      repId: callAttempts.repId,
      repName: reps.name,
      leadName: leads.name,
      company: leads.company,
      repNote: callAttempts.repNote,
      verified: callAttempts.bookingVerified,
      verifiedAt: callAttempts.bookingVerifiedAt,
      verifiedByName: users.name,
      verifiedByEmail: users.email,
    })
    .from(callAttempts)
    .leftJoin(reps, eq(reps.id, callAttempts.repId))
    .leftJoin(leads, eq(leads.id, callAttempts.leadId))
    .leftJoin(users, eq(users.id, callAttempts.bookingVerifiedBy))
    .where(eq(callAttempts.disposition, "booked"))
    .orderBy(desc(callAttempts.startedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt,
    phone: r.phone,
    repId: r.repId,
    repName: r.repName,
    leadName: r.leadName,
    company: r.company,
    repNote: r.repNote,
    verified: r.verified,
    verifiedAt: r.verifiedAt,
    verifiedByName: r.verifiedByName ?? r.verifiedByEmail ?? null,
  }));
}

/**
 * Mark a booked call verified (or clear it), stamping who confirmed it and when.
 * Scoped to `disposition = 'booked'` rows so the flag can never be set on a call
 * that wasn't a booking claim in the first place.
 */
export async function setBookingVerified(
  callId: string,
  verified: boolean,
  userId: string,
): Promise<void> {
  await db
    .update(callAttempts)
    .set({
      bookingVerified: verified,
      bookingVerifiedBy: verified ? userId : null,
      bookingVerifiedAt: verified ? new Date() : null,
    })
    .where(and(eq(callAttempts.id, callId), eq(callAttempts.disposition, "booked")));
}
