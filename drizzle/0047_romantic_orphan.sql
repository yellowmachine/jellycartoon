CREATE TABLE "recipe_site" (
	"id" serial PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"name" text NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"indexed_at" timestamp,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_site_host_unique" UNIQUE("host")
);
--> statement-breakpoint
CREATE TABLE "recipe_site_page" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"words" text NOT NULL,
	CONSTRAINT "recipe_site_page_site_id_url_unique" UNIQUE("site_id","url")
);
--> statement-breakpoint
ALTER TABLE "recipe_site" ADD CONSTRAINT "recipe_site_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_site_page" ADD CONSTRAINT "recipe_site_page_site_id_recipe_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."recipe_site"("id") ON DELETE cascade ON UPDATE no action;