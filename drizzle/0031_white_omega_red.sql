CREATE TABLE "kid_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	CONSTRAINT "kid_schedule_weekday" CHECK ("kid_schedule"."weekday" between 0 and 6),
	CONSTRAINT "kid_schedule_minutes" CHECK (0 <= "kid_schedule"."start_minute" and "kid_schedule"."start_minute" < "kid_schedule"."end_minute" and "kid_schedule"."end_minute" <= 1440)
);
--> statement-breakpoint
CREATE TABLE "kid_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"daily_minutes" integer
);
--> statement-breakpoint
ALTER TABLE "kid_schedule" ADD CONSTRAINT "kid_schedule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_settings" ADD CONSTRAINT "kid_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kid_schedule_user_idx" ON "kid_schedule" USING btree ("user_id");