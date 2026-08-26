import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config(); // load .env

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations run DDL, which a transaction-mode pooler (Supabase's :6543
    // pgBouncer endpoint) can't handle. Point DATABASE_URL_DIRECT at the direct
    // :5432 connection for migrations; the app itself can keep using the pooler.
    url: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
