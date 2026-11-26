ALTER TABLE "note" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "note" ADD COLUMN "article" jsonb;--> statement-breakpoint
ALTER TABLE "note" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;