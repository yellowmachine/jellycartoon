CREATE TABLE "storage_quota" (
	"family_id" text PRIMARY KEY NOT NULL,
	"bytes" bigint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_quota" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stored_file" (
	"family_id" text NOT NULL,
	"area" text NOT NULL,
	"name" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stored_file_family_id_area_name_pk" PRIMARY KEY("family_id","area","name")
);
--> statement-breakpoint
ALTER TABLE "stored_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "storage_quota" ADD CONSTRAINT "storage_quota_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "storage_quota_family_reads" ON "storage_quota" AS PERMISSIVE FOR SELECT TO public USING ("storage_quota"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "storage_quota_admin" ON "storage_quota" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.is_admin', true) = 'true') WITH CHECK (current_setting('app.is_admin', true) = 'true');--> statement-breakpoint
CREATE POLICY "stored_file_own" ON "stored_file" AS PERMISSIVE FOR ALL TO public USING ("stored_file"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("stored_file"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "stored_file_admin_reads" ON "stored_file" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.is_admin', true) = 'true');