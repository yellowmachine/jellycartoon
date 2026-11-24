ALTER TABLE "wish" ADD COLUMN "bought_on" date;--> statement-breakpoint
ALTER TABLE "wish" ADD COLUMN "bought_by" text;--> statement-breakpoint
ALTER TABLE "wish" ADD COLUMN "expense_id" integer;--> statement-breakpoint
ALTER TABLE "wish" ADD CONSTRAINT "wish_bought_by_user_id_fk" FOREIGN KEY ("bought_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish" ADD CONSTRAINT "wish_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE set null ON UPDATE no action;