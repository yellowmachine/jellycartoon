CREATE TABLE "owntracks_day" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"distance" real DEFAULT 0 NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"outings" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "owntracks_day_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "owntracks_day" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owntracks_day" ADD CONSTRAINT "owntracks_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "owntracks_day_own" ON "owntracks_day" AS PERMISSIVE FOR ALL TO public USING ("owntracks_day"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("owntracks_day"."user_id" = nullif(current_setting('app.user_id', true), ''));