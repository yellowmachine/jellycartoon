CREATE TABLE "heard" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "heard" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "heard" ADD CONSTRAINT "heard_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heard" ADD CONSTRAINT "heard_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "heard_family_user_idx" ON "heard" USING btree ("family_id","user_id","created_at");--> statement-breakpoint
CREATE POLICY "heard_own" ON "heard" AS PERMISSIVE FOR ALL TO public USING ("heard"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("heard"."family_id" = nullif(current_setting('app.family_id', true), ''));