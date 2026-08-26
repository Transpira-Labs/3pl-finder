ALTER TABLE "contact_ledger" ADD COLUMN "first_messaged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_ledger" ADD COLUMN "last_messaged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_ledger" ADD COLUMN "message_count" integer DEFAULT 0 NOT NULL;