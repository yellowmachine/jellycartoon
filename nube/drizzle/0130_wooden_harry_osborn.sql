CREATE TABLE "fuel_spot" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"fuel_id" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"heats" boolean DEFAULT true NOT NULL,
	"guess_days" integer,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fuel_spot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fuel_unit" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"fuel_id" integer NOT NULL,
	"spot_id" integer NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"whole" boolean DEFAULT true NOT NULL,
	"from_stock" boolean DEFAULT true NOT NULL,
	"purchase_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_unit_spot_started" UNIQUE("spot_id","started_on")
);
--> statement-breakpoint
ALTER TABLE "fuel_unit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fuel_spot" ADD CONSTRAINT "fuel_spot_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_spot" ADD CONSTRAINT "fuel_spot_fuel_id_fuel_id_fk" FOREIGN KEY ("fuel_id") REFERENCES "public"."fuel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_unit" ADD CONSTRAINT "fuel_unit_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_unit" ADD CONSTRAINT "fuel_unit_fuel_id_fuel_id_fk" FOREIGN KEY ("fuel_id") REFERENCES "public"."fuel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_unit" ADD CONSTRAINT "fuel_unit_spot_id_fuel_spot_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."fuel_spot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_unit" ADD CONSTRAINT "fuel_unit_purchase_id_fuel_event_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."fuel_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_spot_fuel_idx" ON "fuel_spot" USING btree ("fuel_id");--> statement-breakpoint
CREATE INDEX "fuel_unit_fuel_idx" ON "fuel_unit" USING btree ("fuel_id","started_on");--> statement-breakpoint
CREATE POLICY "fuel_spot_own" ON "fuel_spot" AS PERMISSIVE FOR ALL TO public USING ("fuel_spot"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("fuel_spot"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "fuel_unit_own" ON "fuel_unit" AS PERMISSIVE FOR ALL TO public USING ("fuel_unit"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("fuel_unit"."family_id" = nullif(current_setting('app.family_id', true), ''));