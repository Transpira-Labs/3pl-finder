CREATE TABLE "daily_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"note" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_notes_day_unique" UNIQUE("day")
);
--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"report" jsonb NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_reports_day_unique" UNIQUE("day")
);
