ALTER TABLE "ai_cost" ADD COLUMN "house_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_cost_family_house_ref_idx" ON "ai_cost" USING btree ("family_id","house_ref");