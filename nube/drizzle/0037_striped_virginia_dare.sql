CREATE TABLE "inbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"level" text DEFAULT 'normal' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"tag" text,
	"from_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family_member" ADD COLUMN "inbox_by_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "from_day" date;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "until_day" date;--> statement-breakpoint
ALTER TABLE "inbox" ADD CONSTRAINT "inbox_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox" ADD CONSTRAINT "inbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox" ADD CONSTRAINT "inbox_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_user_idx" ON "inbox" USING btree ("family_id","user_id","created_at");--> statement-breakpoint
CREATE POLICY "inbox_own" ON "inbox" AS PERMISSIVE FOR ALL TO public USING ("inbox"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("inbox"."family_id" = nullif(current_setting('app.family_id', true), ''));