DROP TABLE "calendar_event" CASCADE;--> statement-breakpoint
DROP TABLE "calendar_event_person" CASCADE;--> statement-breakpoint
ALTER TABLE "alarm" ADD COLUMN "cloud_id" integer;--> statement-breakpoint
ALTER TABLE "alarm" DROP COLUMN "time";--> statement-breakpoint
ALTER TABLE "alarm" DROP COLUMN "start_day";--> statement-breakpoint
ALTER TABLE "alarm" DROP COLUMN "repeat";--> statement-breakpoint
ALTER TABLE "alarm" DROP COLUMN "skip_days";--> statement-breakpoint
ALTER TABLE "alarm" DROP COLUMN "paused";--> statement-breakpoint
ALTER TABLE "alarm" DROP COLUMN "action";--> statement-breakpoint
DROP TYPE "public"."alarm_action";--> statement-breakpoint
DROP TYPE "public"."calendar_remind";