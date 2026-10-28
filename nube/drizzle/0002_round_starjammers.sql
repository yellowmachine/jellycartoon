CREATE TABLE "house_key" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"start" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "house_key_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "house_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "house_key" ADD CONSTRAINT "house_key_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "house_key_own" ON "house_key" AS PERMISSIVE FOR ALL TO public USING ("house_key"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("house_key"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "house_key_by_hash" ON "house_key" AS PERMISSIVE FOR SELECT TO public USING ("house_key"."hash" = nullif(current_setting('app.key_hash', true), ''));