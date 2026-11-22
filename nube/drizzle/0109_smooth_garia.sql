CREATE TABLE "wish" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"person_id" integer NOT NULL,
	"url" text NOT NULL,
	"shop" text NOT NULL,
	"title" text NOT NULL,
	"image_url" text,
	"price_cents" integer,
	"currency" text,
	"note" text,
	"added_by" text,
	"gift_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wish_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "wish" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wish" ADD CONSTRAINT "wish_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish" ADD CONSTRAINT "wish_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish" ADD CONSTRAINT "wish_gift_by_user_id_fk" FOREIGN KEY ("gift_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish" ADD CONSTRAINT "wish_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."family_person"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wish_person_idx" ON "wish" USING btree ("family_id","person_id");--> statement-breakpoint
CREATE POLICY "wish_own" ON "wish" AS PERMISSIVE FOR ALL TO public USING ("wish"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("wish"."family_id" = nullif(current_setting('app.family_id', true), ''));