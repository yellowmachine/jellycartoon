CREATE TABLE "planned_leg" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"day" date NOT NULL,
	"time" time NOT NULL,
	"stops" jsonb NOT NULL,
	"line" jsonb NOT NULL,
	"distance" real NOT NULL,
	"duration" real NOT NULL,
	"event_id" integer
);
--> statement-breakpoint
ALTER TABLE "planned_leg" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_trip" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "planned_trip_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "planned_trip" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_trip_person" (
	"family_id" text NOT NULL,
	"trip_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	CONSTRAINT "planned_trip_person_trip_id_person_id_pk" PRIMARY KEY("trip_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "planned_trip_person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "planned_leg" ADD CONSTRAINT "planned_leg_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_leg" ADD CONSTRAINT "planned_leg_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_leg" ADD CONSTRAINT "planned_leg_trip_fk" FOREIGN KEY ("family_id","trip_id") REFERENCES "public"."planned_trip"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_trip" ADD CONSTRAINT "planned_trip_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_trip" ADD CONSTRAINT "planned_trip_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_trip_person" ADD CONSTRAINT "planned_trip_person_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_trip_person" ADD CONSTRAINT "planned_trip_person_trip_fk" FOREIGN KEY ("family_id","trip_id") REFERENCES "public"."planned_trip"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_trip_person" ADD CONSTRAINT "planned_trip_person_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."family_person"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_leg_trip_idx" ON "planned_leg" USING btree ("trip_id","day","time");--> statement-breakpoint
CREATE POLICY "planned_leg_own" ON "planned_leg" AS PERMISSIVE FOR ALL TO public USING ("planned_leg"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("planned_leg"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "planned_trip_own" ON "planned_trip" AS PERMISSIVE FOR ALL TO public USING ("planned_trip"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("planned_trip"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "planned_trip_person_own" ON "planned_trip_person" AS PERMISSIVE FOR ALL TO public USING ("planned_trip_person"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("planned_trip_person"."family_id" = nullif(current_setting('app.family_id', true), ''));