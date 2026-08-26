ALTER TABLE "ivr_menu_maps" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ivr_menu_maps" CASCADE;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "claimed_by_rep_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_served_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "leads_queue_idx" ON "leads" USING btree ("campaign_id","validation_status","claimed_at");--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "overdial_ratio";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "max_hold_seconds";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "rep_ring_timeout_seconds";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "max_ivr_levels";