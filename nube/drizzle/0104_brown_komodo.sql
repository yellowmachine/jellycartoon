CREATE TABLE "food_estimate" (
	"family_id" text NOT NULL,
	"text" text NOT NULL,
	"food" boolean NOT NULL,
	"by_weight" boolean DEFAULT false NOT NULL,
	"grams" real DEFAULT 0 NOT NULL,
	"kcal100" real DEFAULT 0 NOT NULL,
	"by_hand" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "food_estimate_family_id_text_pk" PRIMARY KEY("family_id","text")
);
--> statement-breakpoint
ALTER TABLE "food_estimate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "food_estimate" ADD CONSTRAINT "food_estimate_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "food_estimate_own" ON "food_estimate" AS PERMISSIVE FOR ALL TO public USING ("food_estimate"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("food_estimate"."family_id" = nullif(current_setting('app.family_id', true), ''));