ALTER TABLE "watch_time" DROP CONSTRAINT "watch_time_user_day_item";--> statement-breakpoint
ALTER TABLE "watch_time" DROP CONSTRAINT "watch_time_one_item";--> statement-breakpoint
ALTER TABLE "watch_time" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_user_day_item" UNIQUE NULLS NOT DISTINCT("user_id","day","episode_id","movie_id","channel_id");--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_one_item" CHECK (num_nonnulls("watch_time"."episode_id", "watch_time"."movie_id", "watch_time"."channel_id") = 1);