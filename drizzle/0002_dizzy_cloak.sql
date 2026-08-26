CREATE TYPE "public"."call_state" AS ENUM('DIALING', 'RINGING', 'IVR_MENU', 'ON_HOLD', 'HUMAN', 'VOICEMAIL', 'DEAD', 'BRIDGED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."consent_basis_type" AS ENUM('express_written', 'express_oral', 'existing_business_relationship', 'inbound_inquiry', 'unrecognized');--> statement-breakpoint
CREATE TYPE "public"."rep_presence" AS ENUM('available', 'away');--> statement-breakpoint
CREATE TABLE "call_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"final_state" "call_state",
	"reached_human" boolean DEFAULT false NOT NULL,
	"bridged" boolean DEFAULT false NOT NULL,
	"abandoned" boolean DEFAULT false NOT NULL,
	"rep_id" uuid,
	"disposition" text,
	"time_to_human_ms" integer,
	"hold_ms" integer,
	"timeline" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"calling_hours_start" integer DEFAULT 8 NOT NULL,
	"calling_hours_end" integer DEFAULT 21 NOT NULL,
	"overdial_ratio" text DEFAULT '1.0' NOT NULL,
	"per_lead_daily_cap" integer DEFAULT 3 NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"max_hold_seconds" integer DEFAULT 480 NOT NULL,
	"rep_ring_timeout_seconds" integer DEFAULT 15 NOT NULL,
	"max_ivr_levels" integer DEFAULT 6 NOT NULL,
	"recording_policy" text DEFAULT 'where_legal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_menu_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination" text NOT NULL,
	"prompt_fingerprint" text NOT NULL,
	"digit" text NOT NULL,
	"reached_human_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"total_time_to_human_ms" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"presence" "rep_presence" DEFAULT 'away' NOT NULL,
	"on_call" boolean DEFAULT false NOT NULL,
	"campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent_basis_type" "consent_basis_type";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent_source" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent_obtained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
CREATE INDEX "call_attempts_campaign_idx" ON "call_attempts" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "call_attempts_lead_idx" ON "call_attempts" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "call_attempts_started_idx" ON "call_attempts" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ivr_map_uniq" ON "ivr_menu_maps" USING btree ("destination","prompt_fingerprint","digit");