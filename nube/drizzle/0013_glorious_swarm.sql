CREATE TYPE "public"."route_map_state" AS ENUM('pending', 'downloading', 'ready', 'failed', 'remove');--> statement-breakpoint
CREATE TABLE "map_device" (
	"family_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "map_device_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "map_device" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "route_map" (
	"family_id" text NOT NULL,
	"route_id" integer NOT NULL,
	"device_id" text NOT NULL,
	"state" "route_map_state" DEFAULT 'pending' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"bytes" bigint,
	"version" text,
	"problem" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "route_map_route_id_device_id_pk" PRIMARY KEY("route_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "route_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_place" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"lon" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"address" text
);
--> statement-breakpoint
ALTER TABLE "saved_place" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_route" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"stops" jsonb NOT NULL,
	"line" jsonb NOT NULL,
	"distance" real NOT NULL,
	"duration" real NOT NULL,
	CONSTRAINT "saved_route_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "saved_route" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp NOT NULL,
	"distance" real DEFAULT 0 NOT NULL,
	"max_speed" real,
	"destination" text,
	"line" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "trip_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "trip" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_photo" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trip_id" integer,
	"taken_at" timestamp NOT NULL,
	"lon" real,
	"lat" real
);
--> statement-breakpoint
ALTER TABLE "trip_photo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family_member" ADD COLUMN "record_trips" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "map_device" ADD CONSTRAINT "map_device_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_device" ADD CONSTRAINT "map_device_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_map" ADD CONSTRAINT "route_map_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_map" ADD CONSTRAINT "route_map_route_fk" FOREIGN KEY ("family_id","route_id") REFERENCES "public"."saved_route"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_map" ADD CONSTRAINT "route_map_device_fk" FOREIGN KEY ("family_id","device_id") REFERENCES "public"."map_device"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_place" ADD CONSTRAINT "saved_place_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_place" ADD CONSTRAINT "saved_place_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_route" ADD CONSTRAINT "saved_route_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_route" ADD CONSTRAINT "saved_route_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photo" ADD CONSTRAINT "trip_photo_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photo" ADD CONSTRAINT "trip_photo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photo" ADD CONSTRAINT "trip_photo_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_place_user_idx" ON "saved_place" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_route_user_idx" ON "saved_route" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trip_user_started_idx" ON "trip" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "trip_photo_user_taken_idx" ON "trip_photo" USING btree ("user_id","taken_at");--> statement-breakpoint
CREATE POLICY "map_device_own" ON "map_device" AS PERMISSIVE FOR ALL TO public USING ("map_device"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("map_device"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "route_map_own" ON "route_map" AS PERMISSIVE FOR ALL TO public USING ("route_map"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("route_map"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "saved_place_own" ON "saved_place" AS PERMISSIVE FOR ALL TO public USING ("saved_place"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("saved_place"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "saved_route_own" ON "saved_route" AS PERMISSIVE FOR ALL TO public USING ("saved_route"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("saved_route"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "trip_own" ON "trip" AS PERMISSIVE FOR ALL TO public USING ("trip"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("trip"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "trip_photo_own" ON "trip_photo" AS PERMISSIVE FOR ALL TO public USING ("trip_photo"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("trip_photo"."family_id" = nullif(current_setting('app.family_id', true), ''));