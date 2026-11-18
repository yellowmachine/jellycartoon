CREATE TABLE "music_source" (
	"family_id" text PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"label" text NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"scanning_since" timestamp,
	"done" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"indexed_at" timestamp,
	"tracks" integer DEFAULT 0 NOT NULL,
	"problem" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "music_source" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "own_album" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"year" integer,
	"cover_key" text,
	"cover_file" text,
	"cover_type" text
);
--> statement-breakpoint
ALTER TABLE "own_album" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "own_track" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"album_id" integer NOT NULL,
	"key" text NOT NULL,
	"etag" text NOT NULL,
	"size" bigint NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"disc" integer,
	"number" integer,
	"duration_sec" integer,
	"mime" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "own_track" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "music_source" ADD CONSTRAINT "music_source_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_album" ADD CONSTRAINT "own_album_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_track" ADD CONSTRAINT "own_track_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_track" ADD CONSTRAINT "own_track_album_id_own_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."own_album"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "own_album_family_title_artist" ON "own_album" USING btree ("family_id","title","artist");--> statement-breakpoint
CREATE UNIQUE INDEX "own_track_family_key" ON "own_track" USING btree ("family_id","key");--> statement-breakpoint
CREATE INDEX "own_track_album" ON "own_track" USING btree ("album_id");--> statement-breakpoint
CREATE POLICY "music_source_own" ON "music_source" AS PERMISSIVE FOR ALL TO public USING ("music_source"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("music_source"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_album_own" ON "own_album" AS PERMISSIVE FOR ALL TO public USING ("own_album"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("own_album"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_track_own" ON "own_track" AS PERMISSIVE FOR ALL TO public USING ("own_track"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("own_track"."family_id" = nullif(current_setting('app.family_id', true), ''));