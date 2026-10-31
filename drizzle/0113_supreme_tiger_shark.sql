ALTER TABLE "tv_shortcut" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_shortcut" ADD COLUMN "kind" text DEFAULT 'url' NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_shortcut" ADD COLUMN "target" text;