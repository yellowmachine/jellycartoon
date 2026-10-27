ALTER TYPE "public"."alarm_kind" ADD VALUE 'preparado';--> statement-breakpoint
ALTER TABLE "alarm" ADD COLUMN "seconds" integer;--> statement-breakpoint
ALTER TABLE "alarm" ADD COLUMN "trigger" text;