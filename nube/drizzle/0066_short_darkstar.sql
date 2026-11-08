CREATE TABLE "plug_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"plug_id" text NOT NULL,
	"family_id" text NOT NULL,
	"days" integer[] NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plug_schedule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family_settings" ADD COLUMN "kwh_price" real;--> statement-breakpoint
ALTER TABLE "plug" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plug" ADD COLUMN "paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "plug" ADD COLUMN "heat_until" timestamp;--> statement-breakpoint
ALTER TABLE "plug" ADD COLUMN "schedule_jobs" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "plug_schedule" ADD CONSTRAINT "plug_schedule_plug_id_plug_id_fk" FOREIGN KEY ("plug_id") REFERENCES "public"."plug"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plug_schedule" ADD CONSTRAINT "plug_schedule_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plug_schedule_plug_idx" ON "plug_schedule" USING btree ("plug_id");--> statement-breakpoint
CREATE POLICY "plug_schedule_own" ON "plug_schedule" AS PERMISSIVE FOR ALL TO public USING ("plug_schedule"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("plug_schedule"."family_id" = nullif(current_setting('app.family_id', true), ''));