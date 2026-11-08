CREATE TABLE "walk_share" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"walk_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trim" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	"last_opened_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "walk_share_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "walk_share" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "walk_share" ADD CONSTRAINT "walk_share_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_share" ADD CONSTRAINT "walk_share_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_share" ADD CONSTRAINT "walk_share_walk_id_walk_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "walk_share_user_idx" ON "walk_share" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "walk_share_walk_idx" ON "walk_share" USING btree ("walk_id");--> statement-breakpoint
CREATE POLICY "walk_share_own" ON "walk_share" AS PERMISSIVE FOR ALL TO public USING ("walk_share"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("walk_share"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "walk_share_by_token" ON "walk_share" AS PERMISSIVE FOR SELECT TO public USING ("walk_share"."token_hash" = nullif(current_setting('app.share_hash', true), ''));