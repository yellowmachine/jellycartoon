CREATE TYPE "public"."subtitle_job_state" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "subtitle_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer,
	"movie_id" integer,
	"lang" text NOT NULL,
	"state" "subtitle_job_state" DEFAULT 'queued' NOT NULL,
	"position" real NOT NULL,
	"error" text,
	"cues" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	CONSTRAINT "subtitle_job_one_item" CHECK (num_nonnulls("subtitle_job"."episode_id", "subtitle_job"."movie_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "subtitle_job" ADD CONSTRAINT "subtitle_job_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_job" ADD CONSTRAINT "subtitle_job_movie_id_movie_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movie"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subtitle_job_state_idx" ON "subtitle_job" USING btree ("state","position");