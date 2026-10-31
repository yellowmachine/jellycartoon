ALTER TABLE "heard" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "heard" ADD COLUMN "learn" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "heard" ADD COLUMN "learned_at" timestamp;