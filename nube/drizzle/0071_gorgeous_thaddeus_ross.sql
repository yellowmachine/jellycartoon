CREATE TABLE "expense_not_duplicate" (
	"family_id" text NOT NULL,
	"a" integer NOT NULL,
	"b" integer NOT NULL,
	CONSTRAINT "expense_not_duplicate_family_id_a_b_pk" PRIMARY KEY("family_id","a","b")
);
--> statement-breakpoint
ALTER TABLE "expense_not_duplicate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "file_hash" text;--> statement-breakpoint
ALTER TABLE "family_settings" ADD COLUMN "page_notices" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "family_settings" ADD COLUMN "page_notices_off" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_not_duplicate" ADD CONSTRAINT "expense_not_duplicate_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_not_duplicate" ADD CONSTRAINT "expense_not_duplicate_a_fk" FOREIGN KEY ("family_id","a") REFERENCES "public"."expense"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_not_duplicate" ADD CONSTRAINT "expense_not_duplicate_b_fk" FOREIGN KEY ("family_id","b") REFERENCES "public"."expense"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_family_file_hash_idx" ON "expense" USING btree ("family_id","file_hash");--> statement-breakpoint
CREATE POLICY "expense_not_duplicate_own" ON "expense_not_duplicate" AS PERMISSIVE FOR ALL TO public USING ("expense_not_duplicate"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("expense_not_duplicate"."family_id" = nullif(current_setting('app.family_id', true), ''));