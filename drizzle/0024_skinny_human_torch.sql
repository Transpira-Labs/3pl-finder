CREATE TYPE "public"."discovery_status" AS ENUM('pending', 'imported', 'skipped', 'duplicate');--> statement-breakpoint
CREATE TABLE "discovered_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"lat" text,
	"lng" text,
	"rating" text,
	"user_rating_count" integer,
	"business_status" text,
	"types" jsonb,
	"search_query" text,
	"status" "discovery_status" DEFAULT 'pending' NOT NULL,
	"imported_lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"location" text NOT NULL,
	"radius_miles" integer DEFAULT 25 NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "place_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "discovered_stores_place_id_uniq" ON "discovered_stores" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "discovered_stores_status_idx" ON "discovered_stores" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_place_id_idx" ON "leads" USING btree ("place_id");