CREATE TYPE "public"."cover_status" AS ENUM('pending', 'found', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."track_status" AS ENUM('pending', 'ready', 'ignored', 'error');--> statement-breakpoint
CREATE TABLE "album" (
	"id" serial PRIMARY KEY NOT NULL,
	"folder" text NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"disc_id" text,
	"cover_status" "cover_status" DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "album_folder_unique" UNIQUE("folder")
);
--> statement-breakpoint
CREATE TABLE "track" (
	"id" serial PRIMARY KEY NOT NULL,
	"album_id" integer,
	"path" text NOT NULL,
	"size" bigint NOT NULL,
	"mtime" timestamp NOT NULL,
	"missing" boolean DEFAULT false NOT NULL,
	"status" "track_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"title" text NOT NULL,
	"artist" text,
	"album_artist" text,
	"album_title" text,
	"number" integer,
	"duration_sec" real,
	CONSTRAINT "track_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "track" ADD CONSTRAINT "track_album_id_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."album"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "track_album_idx" ON "track" USING btree ("album_id","number");