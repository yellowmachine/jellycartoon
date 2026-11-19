CREATE TABLE "msg_file" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text,
	"size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "msg_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "msg_file" ADD CONSTRAINT "msg_file_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msg_file" ADD CONSTRAINT "msg_file_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "msg_file_own" ON "msg_file" AS PERMISSIVE FOR ALL TO public USING ("msg_file"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("msg_file"."family_id" = nullif(current_setting('app.family_id', true), ''));