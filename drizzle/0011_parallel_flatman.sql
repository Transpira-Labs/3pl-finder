CREATE TYPE "public"."email_event_type" AS ENUM('sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed', 'category_updated', 'sequence_completed');--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"smartlead_campaign_id" text NOT NULL,
	"name" text,
	"variant_label" text,
	"our_campaign_id" uuid,
	"tracked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaigns_smartlead_campaign_id_unique" UNIQUE("smartlead_campaign_id")
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "email_event_type" NOT NULL,
	"smartlead_campaign_id" text NOT NULL,
	"email_account_id" text,
	"sequence_number" integer,
	"smartlead_lead_id" text,
	"email" text NOT NULL,
	"lead_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "email_senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"smartlead_account_id" text NOT NULL,
	"from_email" text,
	"from_name" text,
	"label" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_senders_smartlead_account_id_unique" UNIQUE("smartlead_account_id")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "email" text;--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_dedupe_uniq" ON "email_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "email_events_rollup_idx" ON "email_events" USING btree ("smartlead_campaign_id","email_account_id","event_type");--> statement-breakpoint
CREATE INDEX "email_events_email_idx" ON "email_events" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "email_events_lead_idx" ON "email_events" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "email_events_occurred_idx" ON "email_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree (lower("email"));