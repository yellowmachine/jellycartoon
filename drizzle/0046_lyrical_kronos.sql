CREATE TABLE "recipe" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"servings" integer,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"image_url" text,
	"source_url" text NOT NULL,
	"source_name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_source_url_unique" UNIQUE("source_url")
);
--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;