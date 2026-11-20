ALTER TABLE "offline_game" ADD COLUMN "source" text DEFAULT 'casa' NOT NULL;--> statement-breakpoint
ALTER TABLE "own_game" ADD COLUMN "bios_key" text;--> statement-breakpoint
ALTER TABLE "own_game" ADD COLUMN "info" jsonb;