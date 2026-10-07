CREATE TYPE "public"."worker_state" AS ENUM('running', 'paused', 'stopped');--> statement-breakpoint
CREATE TABLE "worker" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"state" "worker_state" DEFAULT 'running' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;