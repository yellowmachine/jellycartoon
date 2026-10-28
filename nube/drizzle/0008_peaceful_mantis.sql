CREATE TABLE "telegram_bot" (
	"family_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"username" text,
	"chat" jsonb,
	"chats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"events" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_bot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_bot" ADD CONSTRAINT "telegram_bot_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "telegram_bot_own" ON "telegram_bot" AS PERMISSIVE FOR ALL TO public USING ("telegram_bot"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("telegram_bot"."family_id" = nullif(current_setting('app.family_id', true), ''));