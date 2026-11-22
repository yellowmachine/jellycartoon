DROP INDEX "wish_person_idx";--> statement-breakpoint
ALTER TABLE "wish" ADD COLUMN "product_key" text;--> statement-breakpoint
ALTER TABLE "wish" ADD COLUMN "price_at" timestamp;--> statement-breakpoint
CREATE INDEX "wish_person_idx" ON "wish" USING btree ("family_id","person_id","product_key");