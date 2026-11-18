ALTER TABLE "music_source" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "music_source" ADD COLUMN "covers_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "music_source" ADD COLUMN "covers_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "music_source" ADD COLUMN "failures" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "own_album" ADD COLUMN "cover_status" text DEFAULT 'pendiente' NOT NULL;--> statement-breakpoint
ALTER TABLE "own_album" ADD COLUMN "cover_source" text;