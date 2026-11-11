CREATE TABLE "chat_message" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_message_user_idx" ON "chat_message" USING btree ("user_id","id");--> statement-breakpoint
CREATE POLICY "chat_message_own" ON "chat_message" AS PERMISSIVE FOR ALL TO public USING ("chat_message"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("chat_message"."family_id" = nullif(current_setting('app.family_id', true), ''));