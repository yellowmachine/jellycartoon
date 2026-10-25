CREATE TYPE "public"."expense_source" AS ENUM('ticket', 'voz', 'mano', 'fijo');--> statement-breakpoint
CREATE TABLE "expense" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"store" text NOT NULL,
	"category" text NOT NULL,
	"total" integer NOT NULL,
	"source" "expense_source" NOT NULL,
	"user_id" text,
	"receipt" text,
	"recurring_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_line" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_id" integer NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"quantity" double precision,
	"amount" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_expense" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"amount" integer NOT NULL,
	"day" integer NOT NULL,
	"last_month" text,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_recurring_id_recurring_expense_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_expense"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line" ADD CONSTRAINT "expense_line_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_date_idx" ON "expense" USING btree ("date");--> statement-breakpoint
CREATE INDEX "expense_line_expense_idx" ON "expense_line" USING btree ("expense_id");