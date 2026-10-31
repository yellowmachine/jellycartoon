CREATE TABLE "prayer" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"voice_id" integer NOT NULL,
	"audio_file" text,
	"audio_key" text,
	"duration_sec" real,
	"generating_since" timestamp,
	"audio_error" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "prayer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prayer_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"title" text NOT NULL,
	"pause_sec" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_list_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "prayer_list" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prayer_list_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"list_id" integer NOT NULL,
	"prayer_id" integer NOT NULL,
	"position" integer NOT NULL,
	"times" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prayer_list_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prayer_voice" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"voice" text NOT NULL,
	"tone" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_voice_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "prayer_voice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family_settings" ADD COLUMN "prayer_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prayer" ADD CONSTRAINT "prayer_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer" ADD CONSTRAINT "prayer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer" ADD CONSTRAINT "prayer_voice_fk" FOREIGN KEY ("family_id","voice_id") REFERENCES "public"."prayer_voice"("family_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_list" ADD CONSTRAINT "prayer_list_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_list_item" ADD CONSTRAINT "prayer_list_item_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_list_item" ADD CONSTRAINT "prayer_list_item_list_fk" FOREIGN KEY ("family_id","list_id") REFERENCES "public"."prayer_list"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_list_item" ADD CONSTRAINT "prayer_list_item_prayer_fk" FOREIGN KEY ("family_id","prayer_id") REFERENCES "public"."prayer"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_voice" ADD CONSTRAINT "prayer_voice_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "prayer_own" ON "prayer" AS PERMISSIVE FOR ALL TO public USING ("prayer"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("prayer"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "prayer_list_own" ON "prayer_list" AS PERMISSIVE FOR ALL TO public USING ("prayer_list"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("prayer_list"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "prayer_list_item_own" ON "prayer_list_item" AS PERMISSIVE FOR ALL TO public USING ("prayer_list_item"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("prayer_list_item"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "prayer_voice_own" ON "prayer_voice" AS PERMISSIVE FOR ALL TO public USING ("prayer_voice"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("prayer_voice"."family_id" = nullif(current_setting('app.family_id', true), ''));