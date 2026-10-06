CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"audio_lang" text,
	"subtitle_lang" text
);
--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN "audio_tracks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN "subtitles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Output changes from a single MP4 to HLS with every audio track: convert everything again.
UPDATE "episode" SET "status" = 'pending', "progress" = 0 WHERE "status" IN ('ready', 'processing', 'error');
