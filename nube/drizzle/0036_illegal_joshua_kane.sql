CREATE TABLE "backup_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ok" boolean NOT NULL,
	"log" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "backup_run_name_created_idx" ON "backup_run" USING btree ("name","created_at");--> statement-breakpoint
CREATE POLICY "family_admin_reads" ON "family" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.is_admin', true) = 'true');--> statement-breakpoint
CREATE POLICY "house_admin_reads" ON "house" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.is_admin', true) = 'true');