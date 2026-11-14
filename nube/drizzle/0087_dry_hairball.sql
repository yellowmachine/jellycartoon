ALTER TYPE "public"."expense_source" ADD VALUE 'banco';--> statement-breakpoint
CREATE TABLE "bank_account" (
	"user_id" text NOT NULL,
	"account_id" bigint NOT NULL,
	"name" text NOT NULL,
	"iban" text,
	"chosen" boolean DEFAULT false NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"last_payment_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_account_user_id_account_id_pk" PRIMARY KEY("user_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "bank_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bank_link" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"bank_user_id" bigint NOT NULL,
	"hook_hash" text NOT NULL,
	"hooked" boolean DEFAULT false NOT NULL,
	"problem" text,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_link_hook_hash_unique" UNIQUE("hook_hash")
);
--> statement-breakpoint
ALTER TABLE "bank_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bank_payment" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"provider" text NOT NULL,
	"payment_id" bigint NOT NULL,
	"user_id" text,
	"expense_id" integer,
	"joined" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_payment_once" UNIQUE("family_id","provider","payment_id")
);
--> statement-breakpoint
ALTER TABLE "bank_payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_link" ADD CONSTRAINT "bank_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_payment" ADD CONSTRAINT "bank_payment_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_payment" ADD CONSTRAINT "bank_payment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_payment" ADD CONSTRAINT "bank_payment_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_payment_expense_idx" ON "bank_payment" USING btree ("expense_id");--> statement-breakpoint
CREATE POLICY "bank_account_own" ON "bank_account" AS PERMISSIVE FOR ALL TO public USING ("bank_account"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("bank_account"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "bank_link_own" ON "bank_link" AS PERMISSIVE FOR ALL TO public USING ("bank_link"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("bank_link"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "bank_link_by_hash" ON "bank_link" AS PERMISSIVE FOR SELECT TO public USING ("bank_link"."hook_hash" = nullif(current_setting('app.key_hash', true), ''));--> statement-breakpoint
CREATE POLICY "bank_payment_own" ON "bank_payment" AS PERMISSIVE FOR ALL TO public USING ("bank_payment"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("bank_payment"."family_id" = nullif(current_setting('app.family_id', true), ''));