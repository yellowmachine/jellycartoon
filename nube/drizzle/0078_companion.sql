CREATE TABLE "companion" (
	"family_id" text PRIMARY KEY NOT NULL,
	"on" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"satellite_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"every_minutes" integer DEFAULT 30 NOT NULL,
	"from_time" time DEFAULT '09:00' NOT NULL,
	"to_time" time DEFAULT '22:00' NOT NULL,
	"retries" integer DEFAULT 2 NOT NULL,
	"retry_minutes" integer DEFAULT 2 NOT NULL,
	"paused_until" timestamp,
	"paused_by" text,
	"last_signal_at" timestamp,
	"last_check_at" timestamp,
	"attempt" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"asked_at" timestamp,
	"question" text,
	"alert_kind" text,
	"alert_since" timestamp,
	"offline_since" timestamp
);
--> statement-breakpoint
ALTER TABLE "companion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "companion_check" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"answered" boolean NOT NULL,
	"coherent" boolean
);
--> statement-breakpoint
ALTER TABLE "companion_check" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companion" ADD CONSTRAINT "companion_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_check" ADD CONSTRAINT "companion_check_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companion_check_family_at_idx" ON "companion_check" USING btree ("family_id","at");--> statement-breakpoint
CREATE POLICY "companion_own" ON "companion" AS PERMISSIVE FOR ALL TO public USING ("companion"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("companion"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "companion_check_own" ON "companion_check" AS PERMISSIVE FOR ALL TO public USING ("companion_check"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("companion_check"."family_id" = nullif(current_setting('app.family_id', true), ''));