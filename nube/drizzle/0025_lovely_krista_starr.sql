CREATE TABLE "voice_learned" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"place" text NOT NULL,
	"place_name" text NOT NULL,
	"title" text NOT NULL,
	"rule" text NOT NULL,
	"words" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_learned" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "voice_learned" ADD CONSTRAINT "voice_learned_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_learned_place_idx" ON "voice_learned" USING btree ("family_id","place");--> statement-breakpoint
CREATE POLICY "voice_learned_own" ON "voice_learned" AS PERMISSIVE FOR ALL TO public USING ("voice_learned"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("voice_learned"."family_id" = nullif(current_setting('app.family_id', true), ''));