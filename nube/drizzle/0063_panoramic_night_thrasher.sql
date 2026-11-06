CREATE TABLE "watch_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"minute" integer NOT NULL,
	"item" text NOT NULL,
	"kind" text NOT NULL,
	"series_title" text,
	"title" text NOT NULL,
	"season" integer,
	"number" integer,
	"seconds" real NOT NULL,
	CONSTRAINT "watch_log_slot" UNIQUE("user_id","day","minute","item")
);
--> statement-breakpoint
ALTER TABLE "watch_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "watch_log" ADD CONSTRAINT "watch_log_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_log" ADD CONSTRAINT "watch_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watch_log_family_day_idx" ON "watch_log" USING btree ("family_id","day");--> statement-breakpoint
CREATE POLICY "watch_log_own" ON "watch_log" AS PERMISSIVE FOR ALL TO public USING ("watch_log"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("watch_log"."family_id" = nullif(current_setting('app.family_id', true), ''));