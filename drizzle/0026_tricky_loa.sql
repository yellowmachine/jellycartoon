CREATE TABLE "series_tag" (
	"series_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "series_tag_series_id_tag_id_pk" PRIMARY KEY("series_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tag_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "series_tag" ADD CONSTRAINT "series_tag_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_tag" ADD CONSTRAINT "series_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "series_tag_tag_idx" ON "series_tag" USING btree ("tag_id");