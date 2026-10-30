CREATE TYPE "public"."homework_status" AS ENUM('draft', 'assigned', 'done');--> statement-breakpoint
CREATE TABLE "homework" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"kid_id" text NOT NULL,
	"created_by" text,
	"status" "homework_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"band" text NOT NULL,
	"episode_ids" jsonb NOT NULL,
	"episode_names" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"exercises" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules" jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"assigned_at" timestamp,
	"done_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "homework" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_kid_id_user_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "homework_kid_idx" ON "homework" USING btree ("kid_id","status");--> statement-breakpoint
CREATE POLICY "homework_own" ON "homework" AS PERMISSIVE FOR ALL TO public USING ("homework"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("homework"."family_id" = nullif(current_setting('app.family_id', true), ''));