CREATE TABLE "recipe_site" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"host" text NOT NULL,
	"name" text NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"indexed_at" timestamp,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_site_family_id_host_unique" UNIQUE("family_id","host"),
	CONSTRAINT "recipe_site_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "recipe_site" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_site_page" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"site_id" integer NOT NULL,
	"url" text NOT NULL,
	"sitemap" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"words" text NOT NULL,
	CONSTRAINT "recipe_site_page_site_id_url_unique" UNIQUE("site_id","url")
);
--> statement-breakpoint
ALTER TABLE "recipe_site_page" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_site_sitemap" (
	"family_id" text NOT NULL,
	"site_id" integer NOT NULL,
	"url" text NOT NULL,
	"lastmod" text,
	"is_index" boolean DEFAULT false NOT NULL,
	CONSTRAINT "recipe_site_sitemap_site_id_url_pk" PRIMARY KEY("site_id","url")
);
--> statement-breakpoint
ALTER TABLE "recipe_site_sitemap" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_site" ADD CONSTRAINT "recipe_site_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_site" ADD CONSTRAINT "recipe_site_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_site_page" ADD CONSTRAINT "recipe_site_page_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_site_page" ADD CONSTRAINT "recipe_site_page_site_fk" FOREIGN KEY ("family_id","site_id") REFERENCES "public"."recipe_site"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_site_sitemap" ADD CONSTRAINT "recipe_site_sitemap_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_site_sitemap" ADD CONSTRAINT "recipe_site_sitemap_site_fk" FOREIGN KEY ("family_id","site_id") REFERENCES "public"."recipe_site"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "recipe_site_own" ON "recipe_site" AS PERMISSIVE FOR ALL TO public USING ("recipe_site"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("recipe_site"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "recipe_site_page_own" ON "recipe_site_page" AS PERMISSIVE FOR ALL TO public USING ("recipe_site_page"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("recipe_site_page"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "recipe_site_sitemap_own" ON "recipe_site_sitemap" AS PERMISSIVE FOR ALL TO public USING ("recipe_site_sitemap"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("recipe_site_sitemap"."family_id" = nullif(current_setting('app.family_id', true), ''));