CREATE TABLE "paper" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"notes" text,
	"file" text NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "paper" ADD CONSTRAINT "paper_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper" ADD CONSTRAINT "paper_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paper_family_idx" ON "paper" USING btree ("family_id");--> statement-breakpoint
CREATE POLICY "paper_own" ON "paper" AS PERMISSIVE FOR ALL TO public USING ("paper"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("paper"."family_id" = nullif(current_setting('app.family_id', true), ''));