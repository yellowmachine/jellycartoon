ALTER TABLE "medication" ADD COLUMN "doses" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "medication_dose" ADD COLUMN "dose" text;