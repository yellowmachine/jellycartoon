CREATE TABLE "music_playlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_playlist_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"playlist_id" integer NOT NULL,
	"track_id" integer NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "music_playlist_item" ADD CONSTRAINT "music_playlist_item_playlist_id_music_playlist_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."music_playlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_playlist_item" ADD CONSTRAINT "music_playlist_item_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "music_playlist_item_playlist_idx" ON "music_playlist_item" USING btree ("playlist_id","position");