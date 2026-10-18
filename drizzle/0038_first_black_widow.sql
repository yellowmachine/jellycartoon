ALTER TABLE "watch_time" DROP CONSTRAINT "watch_time_user_day_item";--> statement-breakpoint
ALTER TABLE "watch_time" ADD COLUMN "minute" integer;--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_user_day_item" UNIQUE NULLS NOT DISTINCT("user_id","day","minute","episode_id","movie_id","channel_id");--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_minute" CHECK ("watch_time"."minute" between 0 and 1439);