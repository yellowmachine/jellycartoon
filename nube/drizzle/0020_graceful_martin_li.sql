CREATE TABLE "ai_cost" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"app" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"cost" double precision NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_cost" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_cost" ADD CONSTRAINT "ai_cost_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_cost_family_at_idx" ON "ai_cost" USING btree ("family_id","at");--> statement-breakpoint
CREATE POLICY "ai_cost_own" ON "ai_cost" AS PERMISSIVE FOR ALL TO public USING ("ai_cost"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("ai_cost"."family_id" = nullif(current_setting('app.family_id', true), ''));