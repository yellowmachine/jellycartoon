ALTER TABLE "note" ADD COLUMN "photo" text;--> statement-breakpoint
ALTER TABLE "note" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;