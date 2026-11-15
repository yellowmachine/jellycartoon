CREATE TABLE "fuel" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"kind" text NOT NULL,
	"starts_on_buy" boolean NOT NULL,
	"alert_days" integer DEFAULT 5 NOT NULL,
	"guess_days" integer,
	"notified_for" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_family_kind" UNIQUE("family_id","kind")
);
--> statement-breakpoint
ALTER TABLE "fuel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fuel_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"fuel_id" integer NOT NULL,
	"kind" text NOT NULL,
	"day" date NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"expense_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fuel_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fuel" ADD CONSTRAINT "fuel_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_event" ADD CONSTRAINT "fuel_event_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_event" ADD CONSTRAINT "fuel_event_fuel_id_fuel_id_fk" FOREIGN KEY ("fuel_id") REFERENCES "public"."fuel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_event" ADD CONSTRAINT "fuel_event_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_event_fuel_day_idx" ON "fuel_event" USING btree ("fuel_id","day");--> statement-breakpoint
CREATE POLICY "fuel_own" ON "fuel" AS PERMISSIVE FOR ALL TO public USING ("fuel"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("fuel"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "fuel_event_own" ON "fuel_event" AS PERMISSIVE FOR ALL TO public USING ("fuel_event"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("fuel_event"."family_id" = nullif(current_setting('app.family_id', true), ''));