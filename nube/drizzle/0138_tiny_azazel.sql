ALTER TABLE "plug" ADD COLUMN "satellite_fp" text;--> statement-breakpoint
ALTER TABLE "voice_satellite" ADD COLUMN "trust_fp" text;--> statement-breakpoint
ALTER TABLE "voice_satellite" ADD COLUMN "plug_rules" jsonb;--> statement-breakpoint
ALTER TABLE "voice_satellite" ADD COLUMN "plug_rules_kept" integer DEFAULT 0 NOT NULL;