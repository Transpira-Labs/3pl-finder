CREATE TYPE "public"."email_cell_status" AS ENUM('pending', 'creating', 'sequenced', 'assigned', 'scheduled', 'leads_added', 'started', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_experiment_status" AS ENUM('draft', 'queued', 'launching', 'running', 'partially_failed', 'completed', 'canceled');--> statement-breakpoint
CREATE TABLE "email_experiment_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"smartlead_campaign_id" text,
	"status" "email_cell_status" DEFAULT 'pending' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_experiment_cells_smartlead_campaign_id_unique" UNIQUE("smartlead_campaign_id")
);
--> statement-breakpoint
CREATE TABLE "email_experiment_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cell_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"recipients_per_cell" integer NOT NULL,
	"status" "email_experiment_status" DEFAULT 'draft' NOT NULL,
	"schedule_config" jsonb,
	"created_by" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"launched_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppression_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "email_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_cells_combo_uniq" ON "email_experiment_cells" USING btree ("experiment_id","variant_id","sender_id");--> statement-breakpoint
CREATE INDEX "email_cells_experiment_idx" ON "email_experiment_cells" USING btree ("experiment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_recipients_experiment_lead_uniq" ON "email_experiment_recipients" USING btree ("experiment_id","lead_id");--> statement-breakpoint
CREATE INDEX "email_recipients_lead_idx" ON "email_experiment_recipients" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "email_recipients_cell_idx" ON "email_experiment_recipients" USING btree ("cell_id");