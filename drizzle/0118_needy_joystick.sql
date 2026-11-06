ALTER TABLE "user_settings" ADD COLUMN "forget_sent_watch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_time" ADD COLUMN "sent_seconds" real DEFAULT 0 NOT NULL;