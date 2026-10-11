CREATE TYPE "public"."series_info_status" AS ENUM('found', 'ambiguous', 'not_found');--> statement-breakpoint
CREATE TABLE "series_info" (
	"series_id" integer PRIMARY KEY NOT NULL,
	"status" "series_info_status" NOT NULL,
	"wikidata_id" text,
	"title" text,
	"original_title" text,
	"start_year" integer,
	"end_year" integer,
	"seasons" integer,
	"episodes" integer,
	"synopsis" text,
	"wikipedia_url" text,
	"episode_pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "series_info" ADD CONSTRAINT "series_info_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;