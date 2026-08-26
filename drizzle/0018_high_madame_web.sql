CREATE TYPE "public"."sms_status" AS ENUM('queued', 'sent', 'delivered', 'undelivered', 'failed');--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"call_attempt_id" uuid,
	"rep_id" uuid,
	"to_phone" text NOT NULL,
	"from_phone" text NOT NULL,
	"draft_body" text NOT NULL,
	"body" text NOT NULL,
	"status" "sms_status" DEFAULT 'queued' NOT NULL,
	"twilio_sid" text,
	"error_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_messages_lead_idx" ON "sms_messages" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "sms_messages_twilio_sid_idx" ON "sms_messages" USING btree ("twilio_sid");