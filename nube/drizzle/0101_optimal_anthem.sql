CREATE TABLE "plug_reading" (
	"plug_id" text NOT NULL,
	"family_id" text NOT NULL,
	"at" timestamp NOT NULL,
	"temp_c" real,
	"humidity" real,
	"battery" integer,
	"external" boolean,
	CONSTRAINT "plug_reading_plug_id_at_pk" PRIMARY KEY("plug_id","at")
);
--> statement-breakpoint
ALTER TABLE "plug_reading" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plug_reading" ADD CONSTRAINT "plug_reading_plug_id_plug_id_fk" FOREIGN KEY ("plug_id") REFERENCES "public"."plug"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plug_reading" ADD CONSTRAINT "plug_reading_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plug_reading_family_at_idx" ON "plug_reading" USING btree ("family_id","at");--> statement-breakpoint
CREATE POLICY "plug_reading_own" ON "plug_reading" AS PERMISSIVE FOR ALL TO public USING ("plug_reading"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("plug_reading"."family_id" = nullif(current_setting('app.family_id', true), ''));