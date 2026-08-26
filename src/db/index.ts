import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Reuse a single postgres client across hot reloads in dev.
const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof postgres>;
};

// Local Postgres vs. a hosted provider (Supabase, Neon, …):
//  - Hosted requires TLS. postgres.js "require" encrypts without CA verification,
//    which is what Supabase's connection strings use (sslmode=require).
//  - A transaction-mode pooler (pgBouncer — e.g. Supabase's :6543 pooler) does NOT
//    support prepared statements, so disable them there. Detected by the :6543
//    port or DATABASE_POOLED=true. Use the direct/session connection (5432) for
//    running migrations (DDL); the pooler is for the running app at scale.
const isLocal = /@(localhost|127\.0\.0\.1|::1)[:/]/.test(connectionString);

// Two different things, previously conflated — which is what took production
// down on 2026-07-30:
//
//  - `behindPooler`: anything fronted by pgBouncer, in EITHER mode. Supabase's
//    session-mode endpoint (:5432) caps at pool_size 15 across the whole
//    project, so a generous per-instance pool is what exhausts it: Fluid
//    Compute runs several instances, and 2 × max:10 already overruns 15. Every
//    DB-backed route then fails at once with EMAXCONNSESSION. Keep the pool
//    small whenever a pooler is in front, not just on :6543.
//  - `isTransactionPooler`: transaction mode (:6543) specifically. Only this
//    mode forbids prepared statements. Session mode supports them, so leaving
//    them on there is both correct and faster.
//
// Migrations still need the session/direct endpoint (DDL) — see
// DATABASE_URL_DIRECT in drizzle.config.ts.
const behindPooler =
  process.env.DATABASE_POOLED === "true" ||
  /pooler\.supabase\.com|pgbouncer/i.test(connectionString) ||
  connectionString.includes(":6543");
const isTransactionPooler =
  process.env.DATABASE_POOLED === "true" || connectionString.includes(":6543");

if (behindPooler && !isTransactionPooler && process.env.NODE_ENV === "production") {
  // Loud, because the failure it precedes looks like a total outage rather than
  // a configuration mistake.
  console.warn(
    "[db] DATABASE_URL points at a SESSION-mode pooler (:5432). That endpoint " +
      "caps at ~15 clients project-wide and will exhaust under concurrency. " +
      "Point the app at the transaction pooler (:6543) and keep :5432 in " +
      "DATABASE_URL_DIRECT for migrations.",
  );
}

const client =
  globalForDb.__pgClient ??
  postgres(connectionString, {
    // A small pool even when pooled. Transaction-mode pooling requires
    // `prepare: false` — it does NOT require a single connection, and max:1 is
    // actively dangerous on a host that runs concurrent invocations in one
    // instance: every request shares that one connection, so a single query
    // that never completes wedges the whole instance permanently and every
    // later request queues behind it forever. That is exactly what took the
    // deployed app down — pages kept rendering while everything touching the
    // database hung.
    max: behindPooler ? 5 : 10,
    ssl: isLocal ? false : "require",
    prepare: isTransactionPooler ? false : undefined,
    // Recycle idle connections rather than holding them open indefinitely, so a
    // connection left in a bad state by a killed invocation drops out of the
    // pool instead of poisoning it.
    idle_timeout: 20,
    // Fail fast on a connect that can't complete; hanging forever turns a
    // transient network problem into an outage.
    connect_timeout: 10,
  });
if (process.env.NODE_ENV !== "production") {
  globalForDb.__pgClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
