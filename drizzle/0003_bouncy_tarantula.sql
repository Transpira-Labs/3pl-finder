ALTER TABLE "call_attempts" ALTER COLUMN "lead_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "call_attempts" ALTER COLUMN "campaign_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "source" text DEFAULT 'dialer' NOT NULL;--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "rep_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "rep_note" text;--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "synced_to_sheet" boolean DEFAULT false NOT NULL;