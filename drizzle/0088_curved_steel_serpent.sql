ALTER TYPE "public"."expense_source" ADD VALUE 'factura';--> statement-breakpoint
CREATE TABLE "bill" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_id" integer NOT NULL,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"consumption" double precision,
	"unit" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bill_expense_id_unique" UNIQUE("expense_id")
);
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_kind_period_idx" ON "bill" USING btree ("kind","period_end");