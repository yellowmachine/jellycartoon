CREATE TABLE "voice_satellite" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"start" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	CONSTRAINT "voice_satellite_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "voice_satellite" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "voice_satellite" ADD CONSTRAINT "voice_satellite_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "voice_satellite_own" ON "voice_satellite" AS PERMISSIVE FOR ALL TO public USING ("voice_satellite"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("voice_satellite"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "voice_satellite_by_hash" ON "voice_satellite" AS PERMISSIVE FOR SELECT TO public USING ("voice_satellite"."hash" = nullif(current_setting('app.key_hash', true), ''));