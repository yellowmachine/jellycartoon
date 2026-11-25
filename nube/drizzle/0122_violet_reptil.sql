ALTER TABLE "wish" ADD COLUMN "shipping_cents" integer;--> statement-breakpoint
ALTER TABLE "wish" ADD COLUMN "shipping_source" text DEFAULT 'servidor' NOT NULL;