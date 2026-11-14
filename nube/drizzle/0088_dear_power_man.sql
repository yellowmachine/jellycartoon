CREATE TABLE "section_visit" (
	"user_id" text NOT NULL,
	"section" text NOT NULL,
	"day" date NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"last_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "section_visit_user_id_section_day_pk" PRIMARY KEY("user_id","section","day")
);
--> statement-breakpoint
ALTER TABLE "section_visit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "section_visit" ADD CONSTRAINT "section_visit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "section_visit_own" ON "section_visit" AS PERMISSIVE FOR ALL TO public USING ("section_visit"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("section_visit"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "section_visit_admin_reads" ON "section_visit" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.is_admin', true) = 'true');--> statement-breakpoint
CREATE POLICY "section_visit_admin_forgets" ON "section_visit" AS PERMISSIVE FOR DELETE TO public USING (current_setting('app.is_admin', true) = 'true');