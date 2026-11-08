ALTER TABLE "plug" ADD COLUMN "notify_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plug" ADD COLUMN "notify_stopped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plug" ADD COLUMN "notify_offline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plug" ADD COLUMN "notify_on_hours" integer;--> statement-breakpoint
ALTER TABLE "plug" ADD COLUMN "notify_aloud" boolean DEFAULT false NOT NULL;