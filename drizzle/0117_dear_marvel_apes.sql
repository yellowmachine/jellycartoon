CREATE TYPE "public"."lyrics_kind" AS ENUM('synced', 'plain', 'instrumental', 'none');--> statement-breakpoint
CREATE TABLE "track_lyrics" (
	"track_id" integer PRIMARY KEY NOT NULL,
	"kind" "lyrics_kind" NOT NULL,
	"text" text,
	"source" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "track_lyrics" ADD CONSTRAINT "track_lyrics_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE cascade ON UPDATE no action;