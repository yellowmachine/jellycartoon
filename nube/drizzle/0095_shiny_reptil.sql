CREATE TABLE "own_playlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "own_playlist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "own_playlist_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"playlist_id" integer NOT NULL,
	"track_id" integer NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "own_playlist_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "own_playlist" ADD CONSTRAINT "own_playlist_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_playlist_item" ADD CONSTRAINT "own_playlist_item_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_playlist_item" ADD CONSTRAINT "own_playlist_item_playlist_id_own_playlist_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."own_playlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_playlist_item" ADD CONSTRAINT "own_playlist_item_track_id_own_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."own_track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "own_playlist_item_list" ON "own_playlist_item" USING btree ("playlist_id","position");--> statement-breakpoint
CREATE POLICY "own_playlist_own" ON "own_playlist" AS PERMISSIVE FOR ALL TO public USING ("own_playlist"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("own_playlist"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_playlist_item_own" ON "own_playlist_item" AS PERMISSIVE FOR ALL TO public USING ("own_playlist_item"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("own_playlist_item"."family_id" = nullif(current_setting('app.family_id', true), ''));