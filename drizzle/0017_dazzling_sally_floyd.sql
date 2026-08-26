CREATE TABLE "campaign_reps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"rep_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_reps_uniq" ON "campaign_reps" USING btree ("campaign_id","rep_id");--> statement-breakpoint
CREATE INDEX "campaign_reps_rep_idx" ON "campaign_reps" USING btree ("rep_id");