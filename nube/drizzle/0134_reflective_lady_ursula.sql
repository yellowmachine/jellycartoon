CREATE TABLE "news_link" (
	"user_id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"username" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "news_link" ADD CONSTRAINT "news_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "news_link_own" ON "news_link" AS PERMISSIVE FOR ALL TO public USING ("news_link"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("news_link"."user_id" = nullif(current_setting('app.user_id', true), ''));