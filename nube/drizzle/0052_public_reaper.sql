CREATE TABLE "family_data_key" (
	"family_id" text PRIMARY KEY NOT NULL,
	"wrapped" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_data_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family_data_key" ADD CONSTRAINT "family_data_key_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "family_data_key_own" ON "family_data_key" AS PERMISSIVE FOR ALL TO public USING ("family_data_key"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("family_data_key"."family_id" = nullif(current_setting('app.family_id', true), ''));