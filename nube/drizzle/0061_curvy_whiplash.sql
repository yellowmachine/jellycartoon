CREATE TABLE "note" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text,
	"client_id" text,
	"text" text DEFAULT '' NOT NULL,
	"hearing" text DEFAULT 'ready' NOT NULL,
	"audio" text,
	"source" text NOT NULL,
	"walk_id" integer,
	"lon" real,
	"lat" real,
	"at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "note_user_client" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "walk_photo" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"walk_id" integer NOT NULL,
	"client_id" text NOT NULL,
	"file" text NOT NULL,
	"lon" real,
	"lat" real,
	"at" timestamp NOT NULL,
	CONSTRAINT "walk_photo_user_client" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "walk_photo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_walk_id_walk_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walk"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_photo" ADD CONSTRAINT "walk_photo_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_photo" ADD CONSTRAINT "walk_photo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_photo" ADD CONSTRAINT "walk_photo_walk_id_walk_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_family_user_at_idx" ON "note" USING btree ("family_id","user_id","at");--> statement-breakpoint
CREATE INDEX "note_walk_idx" ON "note" USING btree ("walk_id");--> statement-breakpoint
CREATE INDEX "walk_photo_walk_idx" ON "walk_photo" USING btree ("walk_id");--> statement-breakpoint
CREATE POLICY "note_own" ON "note" AS PERMISSIVE FOR ALL TO public USING ("note"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("note"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "walk_photo_own" ON "walk_photo" AS PERMISSIVE FOR ALL TO public USING ("walk_photo"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("walk_photo"."family_id" = nullif(current_setting('app.family_id', true), ''));