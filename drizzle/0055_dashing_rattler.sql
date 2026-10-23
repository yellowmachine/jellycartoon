CREATE TYPE "public"."label_job_state" AS ENUM('queued', 'running', 'failed');--> statement-breakpoint
CREATE TABLE "episode_label" (
	"episode_id" integer NOT NULL,
	"label" text NOT NULL,
	"times" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "episode_label_episode_id_label_pk" PRIMARY KEY("episode_id","label")
);
--> statement-breakpoint
CREATE TABLE "label_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"state" "label_job_state" DEFAULT 'queued' NOT NULL,
	"position" real NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "episode_label" ADD CONSTRAINT "episode_label_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_job" ADD CONSTRAINT "label_job_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_label_label_idx" ON "episode_label" USING btree ("label");--> statement-breakpoint
CREATE INDEX "label_job_state_idx" ON "label_job" USING btree ("state","position");