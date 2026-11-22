CREATE TABLE "owntracks_event" (
	"user_id" text NOT NULL,
	"at" timestamp NOT NULL,
	"place" text NOT NULL,
	"moment" text NOT NULL,
	CONSTRAINT "owntracks_event_user_id_at_place_pk" PRIMARY KEY("user_id","at","place")
);
--> statement-breakpoint
ALTER TABLE "owntracks_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owntracks_event" ADD CONSTRAINT "owntracks_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "owntracks_event_own" ON "owntracks_event" AS PERMISSIVE FOR ALL TO public USING ("owntracks_event"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("owntracks_event"."user_id" = nullif(current_setting('app.user_id', true), ''));