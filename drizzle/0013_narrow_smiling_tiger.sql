CREATE TYPE "public"."movie_status" AS ENUM('pending', 'ready', 'error');--> statement-breakpoint
CREATE TABLE "movie" (
	"id" serial PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"custom_title" text,
	"year" integer,
	"size" bigint NOT NULL,
	"mtime" timestamp NOT NULL,
	"missing" boolean DEFAULT false NOT NULL,
	"status" "movie_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"duration_sec" real,
	"video" text,
	"audio_tracks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtitles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "movie_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE INDEX "movie_status_idx" ON "movie" USING btree ("status");