CREATE TABLE "expense_merge" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"expense_id" integer NOT NULL,
	"parts" jsonb NOT NULL,
	"took_lines" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_merge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family_member" ADD COLUMN "charge_notices" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD COLUMN "paid_from" text;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD COLUMN "notice" integer;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD COLUMN "notice_all" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_merge" ADD CONSTRAINT "expense_merge_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_merge" ADD CONSTRAINT "expense_merge_expense_fk" FOREIGN KEY ("family_id","expense_id") REFERENCES "public"."expense"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_merge_expense_idx" ON "expense_merge" USING btree ("expense_id");--> statement-breakpoint
CREATE POLICY "expense_merge_own" ON "expense_merge" AS PERMISSIVE FOR ALL TO public USING ("expense_merge"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("expense_merge"."family_id" = nullif(current_setting('app.family_id', true), ''));