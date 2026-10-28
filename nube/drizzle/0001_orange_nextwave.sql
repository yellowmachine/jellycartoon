CREATE TYPE "public"."fridge_note_kind" AS ENUM('note', 'list');--> statement-breakpoint
CREATE TABLE "family_settings" (
	"family_id" text PRIMARY KEY NOT NULL,
	"openrouter_key" text,
	"recipes_backdrop" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fridge_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"note_id" integer NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fridge_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fridge_note" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"kind" "fridge_note_kind" DEFAULT 'note' NOT NULL,
	"user_id" text,
	"text" text NOT NULL,
	"until" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fridge_note_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "fridge_note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"title" text NOT NULL,
	"servings" integer,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"image_url" text,
	"source_url" text NOT NULL,
	"source_name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_family_id_source_url_unique" UNIQUE("family_id","source_url")
);
--> statement-breakpoint
ALTER TABLE "recipe" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family_settings" ADD CONSTRAINT "family_settings_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_settings" ADD CONSTRAINT "family_settings_recipes_backdrop_recipe_id_fk" FOREIGN KEY ("recipes_backdrop") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fridge_item" ADD CONSTRAINT "fridge_item_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fridge_item" ADD CONSTRAINT "fridge_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fridge_item" ADD CONSTRAINT "fridge_item_note_fk" FOREIGN KEY ("family_id","note_id") REFERENCES "public"."fridge_note"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fridge_note" ADD CONSTRAINT "fridge_note_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fridge_note" ADD CONSTRAINT "fridge_note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fridge_item_note_idx" ON "fridge_item" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "fridge_note_family_idx" ON "fridge_note" USING btree ("family_id","created_at");--> statement-breakpoint
CREATE POLICY "family_settings_own" ON "family_settings" AS PERMISSIVE FOR ALL TO public USING ("family_settings"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("family_settings"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "fridge_item_own" ON "fridge_item" AS PERMISSIVE FOR ALL TO public USING ("fridge_item"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("fridge_item"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "fridge_note_own" ON "fridge_note" AS PERMISSIVE FOR ALL TO public USING ("fridge_note"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("fridge_note"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "recipe_own" ON "recipe" AS PERMISSIVE FOR ALL TO public USING ("recipe"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("recipe"."family_id" = nullif(current_setting('app.family_id', true), ''));