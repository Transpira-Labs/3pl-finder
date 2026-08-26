CREATE TYPE "public"."rep_kind" AS ENUM('phone', 'browser');--> statement-breakpoint
ALTER TABLE "reps" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reps" ADD COLUMN "kind" "rep_kind" DEFAULT 'phone' NOT NULL;--> statement-breakpoint
ALTER TABLE "reps" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "reps" ADD COLUMN "last_seen" timestamp with time zone;