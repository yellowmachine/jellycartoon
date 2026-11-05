CREATE TABLE "walk" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp NOT NULL,
	"distance" real DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"line" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diagnosis" jsonb NOT NULL,
	CONSTRAINT "walk_user_started" UNIQUE("user_id","started_at")
);
--> statement-breakpoint
ALTER TABLE "walk" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "walk" ADD CONSTRAINT "walk_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk" ADD CONSTRAINT "walk_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "walk_user_started_idx" ON "walk" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE POLICY "walk_own" ON "walk" AS PERMISSIVE FOR ALL TO public USING ("walk"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("walk"."family_id" = nullif(current_setting('app.family_id', true), ''));