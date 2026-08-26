CREATE TABLE "store_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"store_name" text NOT NULL,
	"store_address" text,
	"store_phone" text,
	"store_lat" text,
	"store_lng" text,
	"store_rating" text,
	"owner_name" text,
	"owner_phone" text,
	"position" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"user_id" uuid,
	"store_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_list_items" ADD CONSTRAINT "store_list_items_list_id_store_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."store_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_list_items" ADD CONSTRAINT "store_list_items_store_id_discovered_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."discovered_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_list_items_list_store_uniq" ON "store_list_items" USING btree ("list_id","store_id");--> statement-breakpoint
CREATE INDEX "store_list_items_list_idx" ON "store_list_items" USING btree ("list_id");