ALTER TABLE "music_queue" DROP CONSTRAINT "music_queue_podcast_episode_id_podcast_episode_id_fk";--> statement-breakpoint
ALTER TABLE "podcast" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_episode" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_progress" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_subscription" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "podcast" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_episode" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_progress" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_subscription" CASCADE;
