CREATE TYPE "public"."activity_kind" AS ENUM('outcome', 'note', 'stage_change', 'followup', 'system');--> statement-breakpoint
CREATE TYPE "public"."follow_up_channel" AS ENUM('call', 'email');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('pending', 'done', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('new', 'contacted', 'follow_up', 'qualified', 'won', 'lost', 'do_not_contact');--> statement-breakpoint
CREATE TABLE "contact_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"lead_id" uuid,
	"first_found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_called_at" timestamp with time zone,
	"last_called_at" timestamp with time zone,
	"call_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid,
	"rep_id" uuid,
	"channel" "follow_up_channel" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"note" text,
	"status" "follow_up_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"call_attempt_id" uuid,
	"rep_id" uuid,
	"kind" "activity_kind" NOT NULL,
	"template_key" text,
	"body" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "pipeline_stage" "pipeline_stage" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_ledger_phone_uniq" ON "contact_ledger" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "follow_ups_status_due_idx" ON "follow_ups" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "follow_ups_lead_idx" ON "follow_ups" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_activities_lead_idx" ON "lead_activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_pipeline_stage_idx" ON "leads" USING btree ("pipeline_stage");