DROP TABLE "lead_sheets" CASCADE;--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "source_sheet_id";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "source_sheet_tab";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "source_sheet_row";