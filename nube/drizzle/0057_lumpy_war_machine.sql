CREATE TABLE "paper_event" (
	"family_id" text NOT NULL,
	"paper_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	CONSTRAINT "paper_event_paper_id_event_id_pk" PRIMARY KEY("paper_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "paper_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "paper_event" ADD CONSTRAINT "paper_event_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_event" ADD CONSTRAINT "paper_event_paper_fk" FOREIGN KEY ("family_id","paper_id") REFERENCES "public"."paper"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_event" ADD CONSTRAINT "paper_event_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."calendar_event"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paper_event_event_idx" ON "paper_event" USING btree ("event_id");--> statement-breakpoint
CREATE POLICY "paper_event_own" ON "paper_event" AS PERMISSIVE FOR ALL TO public USING ("paper_event"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("paper_event"."family_id" = nullif(current_setting('app.family_id', true), ''));