CREATE TABLE "recurring_income" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"concept" text NOT NULL,
	"category" text NOT NULL,
	"amount" integer NOT NULL,
	"day" integer NOT NULL,
	"month" integer,
	"last_month" text,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_income_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "recurring_income" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "income" ADD COLUMN "recurring_id" integer;--> statement-breakpoint
ALTER TABLE "recurring_income" ADD CONSTRAINT "recurring_income_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_income" ADD CONSTRAINT "recurring_income_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_recurring_fk" FOREIGN KEY ("family_id","recurring_id") REFERENCES "public"."recurring_income"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "recurring_income_own" ON "recurring_income" AS PERMISSIVE FOR ALL TO public USING ("recurring_income"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("recurring_income"."family_id" = nullif(current_setting('app.family_id', true), ''));