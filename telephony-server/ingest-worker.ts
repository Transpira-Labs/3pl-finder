import { config } from "dotenv";
// Google Sheets service-account creds live in .env.local (like the Next app);
// DB URL lives in .env. dotenv never overrides already-set vars.
config({ path: ".env.local" });
config();

import { runIngestPass } from "../src/lib/workers/ingest-pass";

/**
 * Lead ingestion worker — the local, always-on way to run the import loop.
 *
 * The pass itself lives in src/lib/workers/ingest-pass.ts and is shared with the
 * Vercel cron route (/api/cron/ingest), so hosted and local runs do the same
 * thing; this file only supplies the schedule. Use it for development or when
 * you want a tighter poll than the deployed cron gives you.
 *
 * It never places calls — reps dial from the console.
 *
 * Run: `npm run ingest`
 */

const POLL_MS = Number(process.env.LEAD_SHEET_POLL_MS ?? 25000);

let inFlight = false; // skip overlapping passes if a read runs long
let totalImported = 0;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await runIngestPass();
    if (res.imported > 0) {
      totalImported += res.imported;
      console.log(
        `[ingest] ${new Date().toISOString()} — imported ${res.imported} lead(s) ` +
          `from Saleshandy; ${totalImported} total this run`,
      );
    }
  } catch (e) {
    console.error("[ingest] pass failed:", (e as Error)?.stack ?? e);
  } finally {
    inFlight = false;
  }
}

console.log(
  `📄 ingestion worker up — pulling Saleshandy prospects every ${Math.round(POLL_MS / 1000)}s.`,
);
void tick(); // run once immediately, then on the interval
setInterval(() => void tick(), POLL_MS);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
