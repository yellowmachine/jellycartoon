CREATE TABLE "trip_photo" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trip_id" integer,
	"taken_at" timestamp NOT NULL,
	"lon" real,
	"lat" real
);
--> statement-breakpoint
ALTER TABLE "trip_photo" ADD CONSTRAINT "trip_photo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photo" ADD CONSTRAINT "trip_photo_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_photo_user_taken_idx" ON "trip_photo" USING btree ("user_id","taken_at");