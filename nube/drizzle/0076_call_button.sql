ALTER TABLE "family_member" ADD COLUMN "call_button" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_member" ADD COLUMN "call_favorites" jsonb DEFAULT '[]'::jsonb NOT NULL;