ALTER TYPE "public"."label_job_state" ADD VALUE 'done';--> statement-breakpoint
CREATE TABLE "label_set" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"labels" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "label_set_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "episode_label" ADD COLUMN "set_id" integer;--> statement-breakpoint
ALTER TABLE "label_job" ADD COLUMN "set_id" integer;--> statement-breakpoint
ALTER TABLE "label_job" ADD COLUMN "frames" integer;--> statement-breakpoint
ALTER TABLE "label_job" ADD COLUMN "finished_at" timestamp;--> statement-breakpoint
ALTER TABLE "episode_label" ADD CONSTRAINT "episode_label_set_id_label_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."label_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_job" ADD CONSTRAINT "label_job_set_id_label_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."label_set"("id") ON DELETE cascade ON UPDATE no action;