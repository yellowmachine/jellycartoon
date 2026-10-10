CREATE TYPE "public"."log_level" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TABLE "log_entry" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"level" "log_level" NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE INDEX "log_entry_at_idx" ON "log_entry" USING btree ("at");--> statement-breakpoint
CREATE INDEX "log_entry_level_idx" ON "log_entry" USING btree ("level","at");