CREATE TABLE "call" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"caller_id" text,
	"callee_id" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"answered_at" timestamp,
	"ended_at" timestamp,
	"outcome" text
);
--> statement-breakpoint
ALTER TABLE "call" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_caller_id_user_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_callee_id_user_id_fk" FOREIGN KEY ("callee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_family_started_idx" ON "call" USING btree ("family_id","started_at");--> statement-breakpoint
CREATE POLICY "call_own" ON "call" AS PERMISSIVE FOR ALL TO public USING ("call"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("call"."family_id" = nullif(current_setting('app.family_id', true), ''));