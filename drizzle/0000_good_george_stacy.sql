CREATE TYPE "public"."consent_status" AS ENUM('has_basis', 'missing');--> statement-breakpoint
CREATE TYPE "public"."dnc_status" AS ENUM('clear', 'listed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('eligible', 'quarantined', 'blocked', 'invalid');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"subject_phone" text,
	"batch_id" uuid,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "column_mapping_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "column_mapping_templates_vendor_unique" UNIQUE("vendor")
);
--> statement-breakpoint
CREATE TABLE "ingestion_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"uploaded_by" text DEFAULT 'dev' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"quarantined_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"column_mapping" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text,
	"name" text,
	"company" text,
	"timezone" text,
	"source" text,
	"consent_basis" text,
	"consent_status" "consent_status" DEFAULT 'missing' NOT NULL,
	"dnc_status" "dnc_status" DEFAULT 'unknown' NOT NULL,
	"validation_status" "validation_status" NOT NULL,
	"validation_reason" text,
	"last_contacted" timestamp with time zone,
	"disposition" text,
	"ingestion_batch_id" uuid,
	"raw_source_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"reason" text DEFAULT 'internal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_list_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_ingestion_batch_id_ingestion_batches_id_fk" FOREIGN KEY ("ingestion_batch_id") REFERENCES "public"."ingestion_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_phone_eligible_uniq" ON "leads" USING btree ("phone") WHERE validation_status = 'eligible';--> statement-breakpoint
CREATE INDEX "leads_batch_idx" ON "leads" USING btree ("ingestion_batch_id");--> statement-breakpoint
CREATE INDEX "leads_validation_status_idx" ON "leads" USING btree ("validation_status");--> statement-breakpoint
CREATE INDEX "suppression_phone_idx" ON "suppression_list" USING btree ("phone");