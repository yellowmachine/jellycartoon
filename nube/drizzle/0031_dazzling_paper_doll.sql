CREATE TABLE "kid_account" (
	"user_id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kid_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kid_guardian" (
	"family_id" text NOT NULL,
	"kid_id" text NOT NULL,
	"guardian_id" text NOT NULL,
	CONSTRAINT "kid_guardian_kid_id_guardian_id_pk" PRIMARY KEY("kid_id","guardian_id")
);
--> statement-breakpoint
ALTER TABLE "kid_guardian" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kid_account" ADD CONSTRAINT "kid_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_account" ADD CONSTRAINT "kid_account_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_guardian" ADD CONSTRAINT "kid_guardian_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_guardian" ADD CONSTRAINT "kid_guardian_kid_id_user_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_guardian" ADD CONSTRAINT "kid_guardian_guardian_id_user_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kid_guardian_guardian_idx" ON "kid_guardian" USING btree ("guardian_id");--> statement-breakpoint
CREATE POLICY "kid_account_own" ON "kid_account" AS PERMISSIVE FOR ALL TO public USING ("kid_account"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("kid_account"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "kid_guardian_own" ON "kid_guardian" AS PERMISSIVE FOR ALL TO public USING ("kid_guardian"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("kid_guardian"."family_id" = nullif(current_setting('app.family_id', true), ''));