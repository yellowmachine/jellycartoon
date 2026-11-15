CREATE TABLE "report" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"from_day" date NOT NULL,
	"to_day" date NOT NULL,
	"pieces" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_user_idx" ON "report" USING btree ("user_id","id");--> statement-breakpoint
CREATE POLICY "report_own" ON "report" AS PERMISSIVE FOR ALL TO public USING ("report"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("report"."family_id" = nullif(current_setting('app.family_id', true), ''));