CREATE TABLE "expense_tag" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expense_tag_family_id" UNIQUE("family_id","id"),
	CONSTRAINT "expense_tag_family_name" UNIQUE("family_id","name")
);
--> statement-breakpoint
ALTER TABLE "expense_tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expense_tag_rule" (
	"family_id" text NOT NULL,
	"text" text NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "expense_tag_rule_family_id_text_pk" PRIMARY KEY("family_id","text")
);
--> statement-breakpoint
ALTER TABLE "expense_tag_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense_tag" ADD CONSTRAINT "expense_tag_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_tag_rule" ADD CONSTRAINT "expense_tag_rule_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_tag_rule" ADD CONSTRAINT "expense_tag_rule_tag_fk" FOREIGN KEY ("family_id","tag_id") REFERENCES "public"."expense_tag"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_tag_rule_tag_idx" ON "expense_tag_rule" USING btree ("tag_id");--> statement-breakpoint
CREATE POLICY "expense_tag_own" ON "expense_tag" AS PERMISSIVE FOR ALL TO public USING ("expense_tag"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("expense_tag"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "expense_tag_rule_own" ON "expense_tag_rule" AS PERMISSIVE FOR ALL TO public USING ("expense_tag_rule"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("expense_tag_rule"."family_id" = nullif(current_setting('app.family_id', true), ''));