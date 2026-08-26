CREATE TABLE "service_status" (
	"service" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"detail" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
