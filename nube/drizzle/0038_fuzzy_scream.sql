CREATE TABLE "rule" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text,
	"said" text NOT NULL,
	"understood" text NOT NULL,
	"spec" jsonb NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"fired" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_fired_at" timestamp,
	"last_why" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_family_user_idx" ON "rule" USING btree ("family_id","user_id");--> statement-breakpoint
CREATE POLICY "rule_own" ON "rule" AS PERMISSIVE FOR ALL TO public USING ("rule"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("rule"."family_id" = nullif(current_setting('app.family_id', true), ''));