CREATE TABLE "solar" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"groups" jsonb NOT NULL,
	"inverter_kw" real,
	"battery_kwh" real,
	"reserve" integer DEFAULT 10 NOT NULL,
	"day_kwh" real,
	"installed_on" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "solar_family_id_unique" UNIQUE("family_id")
);
--> statement-breakpoint
ALTER TABLE "solar" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "solar" ADD CONSTRAINT "solar_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "solar_own" ON "solar" AS PERMISSIVE FOR ALL TO public USING ("solar"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("solar"."family_id" = nullif(current_setting('app.family_id', true), ''));