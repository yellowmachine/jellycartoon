CREATE TABLE "recipe_site_sitemap" (
	"site_id" integer NOT NULL,
	"url" text NOT NULL,
	"lastmod" text,
	"is_index" boolean DEFAULT false NOT NULL,
	CONSTRAINT "recipe_site_sitemap_site_id_url_pk" PRIMARY KEY("site_id","url")
);
--> statement-breakpoint
ALTER TABLE "recipe_site_page" ADD COLUMN "sitemap" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_site_sitemap" ADD CONSTRAINT "recipe_site_sitemap_site_id_recipe_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."recipe_site"("id") ON DELETE cascade ON UPDATE no action;