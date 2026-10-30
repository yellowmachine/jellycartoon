CREATE TABLE "medication" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"person_id" integer NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"times" time[] NOT NULL,
	"days" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"start_day" date NOT NULL,
	"end_day" date,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "medication_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "medication" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "medication_dose" (
	"family_id" text NOT NULL,
	"medication_id" integer NOT NULL,
	"day" date NOT NULL,
	"time" time NOT NULL,
	"notified_at" timestamp,
	"taken_at" timestamp,
	"taken_by" text,
	CONSTRAINT "medication_dose_medication_id_day_time_pk" PRIMARY KEY("medication_id","day","time")
);
--> statement-breakpoint
ALTER TABLE "medication_dose" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "medication" ADD CONSTRAINT "medication_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication" ADD CONSTRAINT "medication_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication" ADD CONSTRAINT "medication_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."family_person"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_dose" ADD CONSTRAINT "medication_dose_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_dose" ADD CONSTRAINT "medication_dose_taken_by_user_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_dose" ADD CONSTRAINT "medication_dose_medication_fk" FOREIGN KEY ("family_id","medication_id") REFERENCES "public"."medication"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "medication_dose_day_idx" ON "medication_dose" USING btree ("family_id","day");--> statement-breakpoint
CREATE POLICY "medication_own" ON "medication" AS PERMISSIVE FOR ALL TO public USING ("medication"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("medication"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "medication_dose_own" ON "medication_dose" AS PERMISSIVE FOR ALL TO public USING ("medication_dose"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("medication_dose"."family_id" = nullif(current_setting('app.family_id', true), ''));