CREATE TYPE "public"."light_status" AS ENUM('pending', 'processing', 'ready', 'error');--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN "light" "light_status";--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN "light_error" text;