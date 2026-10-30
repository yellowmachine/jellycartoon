ALTER TABLE "memory" ADD COLUMN "rule_id" integer;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "because" text;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_rule_id_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rule"("id") ON DELETE set null ON UPDATE no action;