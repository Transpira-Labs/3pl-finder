ALTER TYPE "public"."consent_basis_type" ADD VALUE 'b2b';--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_sheet_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_sheet_tab" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_sheet_row" integer;