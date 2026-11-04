CREATE TABLE "series_tag" (
	"family_id" text NOT NULL,
	"series_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "series_tag_family_id_series_id_tag_id_pk" PRIMARY KEY("family_id","series_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "series_tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tag" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tag_family_id" UNIQUE("family_id","id"),
	CONSTRAINT "tag_name_unique" UNIQUE("family_id","name")
);
--> statement-breakpoint
ALTER TABLE "tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "series_tag" ADD CONSTRAINT "series_tag_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_tag" ADD CONSTRAINT "series_tag_family_id_tag_id_tag_family_id_id_fk" FOREIGN KEY ("family_id","tag_id") REFERENCES "public"."tag"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "series_tag_tag_idx" ON "series_tag" USING btree ("family_id","tag_id");--> statement-breakpoint
CREATE POLICY "series_tag_own" ON "series_tag" AS PERMISSIVE FOR ALL TO public USING ("series_tag"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("series_tag"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "tag_own" ON "tag" AS PERMISSIVE FOR ALL TO public USING ("tag"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("tag"."family_id" = nullif(current_setting('app.family_id', true), ''));