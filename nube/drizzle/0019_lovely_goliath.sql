CREATE TYPE "public"."alarm_kind" AS ENUM('alarma', 'temporizador');--> statement-breakpoint
ALTER TABLE "alarm" ADD COLUMN "kind" "alarm_kind" DEFAULT 'alarma' NOT NULL;