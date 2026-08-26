import { sql } from "drizzle-orm";
import { db } from "@/db";
import { serviceStatus } from "@/db/schema";

/**
 * Service registry — liveness (heartbeat) + desired on/off for the standalone
 * worker processes. Workers heartbeat every loop and obey `enabled`; the admin
 * Services panel reads status and flips the toggle. No process spawning — this is
 * a portable pause/resume + health view backed by the DB.
 */

// Calling is rep-initiated and served by ordinary Next routes, so there is no
// always-on telephony process to supervise — just the lead-ingestion worker.
export const SERVICES = [
  { name: "ingest", label: "Ingestion worker", command: "npm run ingest" },
] as const;

export type ServiceName = (typeof SERVICES)[number]["name"];

/** A heartbeat older than this ⇒ the process is considered down. */
export const ALIVE_WINDOW_MS = 60_000;

/** Worker call: stamp a fresh heartbeat (+ optional detail). Never touches `enabled`. */
export async function heartbeat(
  service: ServiceName,
  detail?: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(serviceStatus)
    .values({ service, heartbeatAt: new Date(), detail, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: serviceStatus.service,
      set: { heartbeatAt: new Date(), detail: detail ?? null, updatedAt: new Date() },
    });
}

/** Worker gate: is this service enabled? Absent row ⇒ enabled (default on). */
export async function isServiceEnabled(service: ServiceName): Promise<boolean> {
  const [row] = await db
    .select({ enabled: serviceStatus.enabled })
    .from(serviceStatus)
    .where(sql`${serviceStatus.service} = ${service}`);
  return row ? row.enabled : true;
}

/** Panel action: set desired on/off. Upserts so it works before the first heartbeat. */
export async function setServiceEnabled(
  service: ServiceName,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(serviceStatus)
    .values({ service, enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: serviceStatus.service,
      set: { enabled, updatedAt: new Date() },
    });
}

export type ServiceView = {
  name: ServiceName;
  label: string;
  command: string;
  enabled: boolean;
  alive: boolean;
  lastSeen: string | null; // ISO
  detail: Record<string, unknown> | null;
};

/** Panel data: every known service with computed liveness. */
export async function listServiceStatus(): Promise<ServiceView[]> {
  const rows = await db.select().from(serviceStatus);
  const byName = new Map(rows.map((r) => [r.service, r]));
  const now = Date.now();
  return SERVICES.map((s) => {
    const r = byName.get(s.name);
    const hb = r?.heartbeatAt ? new Date(r.heartbeatAt) : null;
    return {
      name: s.name,
      label: s.label,
      command: s.command,
      enabled: r ? r.enabled : true,
      alive: hb ? now - hb.getTime() < ALIVE_WINDOW_MS : false,
      lastSeen: hb ? hb.toISOString() : null,
      detail: (r?.detail as Record<string, unknown>) ?? null,
    };
  });
}
