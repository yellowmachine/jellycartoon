CREATE TYPE "public"."movie_info_status" AS ENUM('found', 'ambiguous', 'not_found');--> statement-breakpoint
CREATE TABLE "movie_info" (
	"movie_id" integer PRIMARY KEY NOT NULL,
	"status" "movie_info_status" NOT NULL,
	"wikidata_id" text,
	"title" text,
	"original_title" text,
	"year" integer,
	"minutes" integer,
	"directors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cast" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"genres" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imdb_id" text,
	"synopsis" text,
	"synopsis_source" text,
	"wikipedia_url" text,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movie_info" ADD CONSTRAINT "movie_info_movie_id_movie_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movie"("id") ON DELETE cascade ON UPDATE no action;