CREATE TABLE "car" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lon" double precision,
	"lat" double precision,
	"accuracy" real,
	"parked_at" timestamp,
	"parked_by" text,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "car" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "car_driver" (
	"family_id" text NOT NULL,
	"user_id" text PRIMARY KEY NOT NULL,
	"car_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "car_driver" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "car_id" integer;--> statement-breakpoint
ALTER TABLE "car" ADD CONSTRAINT "car_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car" ADD CONSTRAINT "car_parked_by_user_id_fk" FOREIGN KEY ("parked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_driver" ADD CONSTRAINT "car_driver_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_driver" ADD CONSTRAINT "car_driver_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_driver" ADD CONSTRAINT "car_driver_car_id_car_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."car"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_car_id_car_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."car"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "car_own" ON "car" AS PERMISSIVE FOR ALL TO public USING ("car"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("car"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "car_driver_own" ON "car_driver" AS PERMISSIVE FOR ALL TO public USING ("car_driver"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("car_driver"."family_id" = nullif(current_setting('app.family_id', true), ''));