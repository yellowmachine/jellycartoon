CREATE TABLE "income" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"date" date NOT NULL,
	"concept" text NOT NULL,
	"category" text NOT NULL,
	"amount" integer NOT NULL,
	"user_id" text,
	"document" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "income" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "income_family_date_idx" ON "income" USING btree ("family_id","date");--> statement-breakpoint
CREATE POLICY "income_own" ON "income" AS PERMISSIVE FOR ALL TO public USING ("income"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("income"."family_id" = nullif(current_setting('app.family_id', true), ''));