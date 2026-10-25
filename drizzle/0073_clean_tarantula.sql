CREATE TYPE "public"."game_info_status" AS ENUM('found', 'ambiguous', 'not_found');--> statement-breakpoint
CREATE TABLE "game" (
	"id" serial PRIMARY KEY NOT NULL,
	"system" text NOT NULL,
	"file" text NOT NULL,
	"status" "game_info_status",
	"wikidata_id" text,
	"title" text,
	"year" integer,
	"developers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publishers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"genres" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"composers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synopsis" text,
	"wikipedia_url" text,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_system_file" UNIQUE("system","file")
);
