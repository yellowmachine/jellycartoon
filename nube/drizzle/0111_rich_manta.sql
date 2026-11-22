CREATE TABLE "location_point" (
	"user_id" text NOT NULL,
	"at" timestamp NOT NULL,
	"lon" real NOT NULL,
	"lat" real NOT NULL,
	"accuracy" integer,
	"speed" integer,
	"altitude" integer,
	"battery" integer,
	"device" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "location_point_user_id_at_pk" PRIMARY KEY("user_id","at")
);
--> statement-breakpoint
ALTER TABLE "location_point" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owntracks_link" (
	"user_id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "owntracks_link_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "owntracks_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "location_point" ADD CONSTRAINT "location_point_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owntracks_link" ADD CONSTRAINT "owntracks_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "location_point_own" ON "location_point" AS PERMISSIVE FOR ALL TO public USING ("location_point"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("location_point"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owntracks_link_own" ON "owntracks_link" AS PERMISSIVE FOR ALL TO public USING ("owntracks_link"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("owntracks_link"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owntracks_link_by_hash" ON "owntracks_link" AS PERMISSIVE FOR SELECT TO public USING ("owntracks_link"."token_hash" = nullif(current_setting('app.key_hash', true), ''));