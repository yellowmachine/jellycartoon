CREATE TABLE "family_storage" (
	"family_id" text PRIMARY KEY NOT NULL,
	"current" text,
	"current_label" text,
	"moving" boolean DEFAULT false NOT NULL,
	"next" text,
	"next_label" text,
	"done" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"problem" text,
	"moved_at" timestamp,
	"cleanup_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_storage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family_storage" ADD CONSTRAINT "family_storage_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "family_storage_own" ON "family_storage" AS PERMISSIVE FOR ALL TO public USING ("family_storage"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("family_storage"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "family_storage_admin_reads" ON "family_storage" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.is_admin', true) = 'true');