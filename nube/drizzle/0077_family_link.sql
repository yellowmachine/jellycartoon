CREATE TABLE "family_link" (
	"id" text PRIMARY KEY NOT NULL,
	"from_family_id" text NOT NULL,
	"to_family_id" text,
	"token" text,
	"invited_by" text,
	"accepted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	CONSTRAINT "family_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "family_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call" DROP CONSTRAINT "call_pkey";--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_id_family_id_pk" PRIMARY KEY("id","family_id");--> statement-breakpoint
ALTER TABLE "family_link" ADD CONSTRAINT "family_link_from_family_id_family_id_fk" FOREIGN KEY ("from_family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_link" ADD CONSTRAINT "family_link_to_family_id_family_id_fk" FOREIGN KEY ("to_family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_link" ADD CONSTRAINT "family_link_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_link" ADD CONSTRAINT "family_link_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "family_link_pair_idx" ON "family_link" USING btree (least("from_family_id", "to_family_id"),greatest("from_family_id", "to_family_id")) WHERE "family_link"."to_family_id" is not null;--> statement-breakpoint
CREATE INDEX "family_link_to_idx" ON "family_link" USING btree ("to_family_id");--> statement-breakpoint
CREATE POLICY "family_link_own" ON "family_link" AS PERMISSIVE FOR ALL TO public USING (nullif(current_setting('app.family_id', true), '') in ("family_link"."from_family_id", "family_link"."to_family_id")) WITH CHECK (nullif(current_setting('app.family_id', true), '') in ("family_link"."from_family_id", "family_link"."to_family_id"));--> statement-breakpoint
CREATE POLICY "family_link_by_token" ON "family_link" AS PERMISSIVE FOR SELECT TO public USING ("family_link"."token" = nullif(current_setting('app.link_token', true), ''));--> statement-breakpoint
CREATE POLICY "family_link_accept" ON "family_link" AS PERMISSIVE FOR UPDATE TO public USING ("family_link"."token" = nullif(current_setting('app.link_token', true), '') and "family_link"."to_family_id" is null) WITH CHECK ("family_link"."to_family_id" = nullif(current_setting('app.family_id', true), ''));