ALTER TABLE "call_attempts" ADD COLUMN "booking_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "booking_verified_by" uuid;--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "booking_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "is_callback_target" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "call_attempts_disposition_idx" ON "call_attempts" USING btree ("disposition");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_callback_target_uniq" ON "campaigns" USING btree ("is_callback_target") WHERE is_callback_target = true;