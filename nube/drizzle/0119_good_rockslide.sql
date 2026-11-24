CREATE TABLE "shopping_photo" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"photo" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_photo_family_name" UNIQUE("family_id","name")
);
--> statement-breakpoint
ALTER TABLE "shopping_photo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shopping_photo" ADD CONSTRAINT "shopping_photo_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_photo" ADD CONSTRAINT "shopping_photo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "shopping_photo_own" ON "shopping_photo" AS PERMISSIVE FOR ALL TO public USING ("shopping_photo"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("shopping_photo"."family_id" = nullif(current_setting('app.family_id', true), ''));