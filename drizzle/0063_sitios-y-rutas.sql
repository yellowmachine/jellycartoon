CREATE TABLE "saved_place" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"lon" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"address" text
);
--> statement-breakpoint
CREATE TABLE "saved_route" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"stops" jsonb NOT NULL,
	"line" jsonb NOT NULL,
	"distance" real NOT NULL,
	"duration" real NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_place" ADD CONSTRAINT "saved_place_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_route" ADD CONSTRAINT "saved_route_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_place_user_idx" ON "saved_place" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_route_user_idx" ON "saved_route" USING btree ("user_id");