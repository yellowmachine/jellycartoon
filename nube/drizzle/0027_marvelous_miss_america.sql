CREATE TABLE "memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text,
	"text" text NOT NULL,
	"words" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_family_user_idx" ON "memory" USING btree ("family_id","user_id");--> statement-breakpoint
CREATE POLICY "memory_own" ON "memory" AS PERMISSIVE FOR ALL TO public USING ("memory"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("memory"."family_id" = nullif(current_setting('app.family_id', true), ''));