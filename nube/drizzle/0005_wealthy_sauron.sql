CREATE TYPE "public"."expense_source" AS ENUM('ticket', 'voz', 'mano', 'fijo', 'factura');--> statement-breakpoint
CREATE TABLE "bill" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
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
ALTER TABLE "bill" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expense" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"date" date NOT NULL,
	"store" text NOT NULL,
	"category" text NOT NULL,
	"total" integer NOT NULL,
	"source" "expense_source" NOT NULL,
	"user_id" text,
	"receipt" text,
	"recurring_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expense_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "expense" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expense_favorite" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"store" text NOT NULL,
	"category" text NOT NULL,
	"total" integer,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_favorite" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expense_line" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"expense_id" integer NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"quantity" double precision,
	"amount" integer NOT NULL,
	"tag" text DEFAULT 'Otros' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recurring_expense" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"amount" integer NOT NULL,
	"day" integer NOT NULL,
	"last_month" text,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_expense_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "recurring_expense" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_expense_fk" FOREIGN KEY ("family_id","expense_id") REFERENCES "public"."expense"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_recurring_fk" FOREIGN KEY ("family_id","recurring_id") REFERENCES "public"."recurring_expense"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_favorite" ADD CONSTRAINT "expense_favorite_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_favorite" ADD CONSTRAINT "expense_favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line" ADD CONSTRAINT "expense_line_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line" ADD CONSTRAINT "expense_line_expense_fk" FOREIGN KEY ("family_id","expense_id") REFERENCES "public"."expense"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_kind_period_idx" ON "bill" USING btree ("family_id","kind","period_end");--> statement-breakpoint
CREATE INDEX "expense_family_date_idx" ON "expense" USING btree ("family_id","date");--> statement-breakpoint
CREATE INDEX "expense_line_expense_idx" ON "expense_line" USING btree ("expense_id");--> statement-breakpoint
CREATE POLICY "bill_own" ON "bill" AS PERMISSIVE FOR ALL TO public USING ("bill"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("bill"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "expense_own" ON "expense" AS PERMISSIVE FOR ALL TO public USING ("expense"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("expense"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "expense_favorite_own" ON "expense_favorite" AS PERMISSIVE FOR ALL TO public USING ("expense_favorite"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("expense_favorite"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "expense_line_own" ON "expense_line" AS PERMISSIVE FOR ALL TO public USING ("expense_line"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("expense_line"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "recurring_expense_own" ON "recurring_expense" AS PERMISSIVE FOR ALL TO public USING ("recurring_expense"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("recurring_expense"."family_id" = nullif(current_setting('app.family_id', true), ''));