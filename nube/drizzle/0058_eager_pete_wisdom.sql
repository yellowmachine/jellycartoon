CREATE TABLE "paper_person" (
	"family_id" text NOT NULL,
	"paper_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	CONSTRAINT "paper_person_paper_id_person_id_pk" PRIMARY KEY("paper_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "paper_person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "paper_person" ADD CONSTRAINT "paper_person_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_person" ADD CONSTRAINT "paper_person_paper_fk" FOREIGN KEY ("family_id","paper_id") REFERENCES "public"."paper"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_person" ADD CONSTRAINT "paper_person_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."family_person"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "paper_person_own" ON "paper_person" AS PERMISSIVE FOR ALL TO public USING ("paper_person"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("paper_person"."family_id" = nullif(current_setting('app.family_id', true), ''));