ALTER TABLE "expense" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "original_total" integer;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "rate" double precision;