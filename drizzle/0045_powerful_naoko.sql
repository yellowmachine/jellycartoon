CREATE TYPE "public"."track_opus" AS ENUM('pending', 'ready', 'error');--> statement-breakpoint
ALTER TABLE "track" ADD COLUMN "opus" "track_opus" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "track" ADD COLUMN "opus_error" text;