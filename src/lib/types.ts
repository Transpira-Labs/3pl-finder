export type BucketId =
  | "ringing"
  | "waiting"
  | "right"
  | "wrong"
  | "voicemail"
  | "noanswer";

export type ActiveId = BucketId | "idle";

export interface Bucket {
  id: BucketId;
  key: string;
  name: string;
  /** Short label for compact controls. */
  short: string;
  sub: string;
  /** Hex accent color (used inline to avoid Tailwind purge of dynamic classes). */
  color: string;
}

export interface Disposition {
  id: string;
  key: string;
  label: string;
}

/** A finished, saved call. `acc` holds milliseconds per bucket. */
export interface Call {
  id: string;
  startedAt: number;
  endedAt: number;
  acc: Record<BucketId, number>;
  disposition: string | null;
  note: string | null;
  synced?: boolean;
}

/** The in-progress call: banked ms per bucket + which bucket is currently running. */
export interface CurrentCall {
  startedAt: number;
  /** When tracking first started this call (first bucket pressed). The saved
   *  call's total = endedAt − firstActiveAt, i.e. the real elapsed call time,
   *  so idle gaps between key presses aren't lost. Null until the first press. */
  firstActiveAt: number | null;
  acc: Record<BucketId, number>;
  active: ActiveId;
  activeSince: number;
}
