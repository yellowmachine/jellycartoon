CREATE TYPE "public"."calendar_remind" AS ENUM('hora', 'dia');--> statement-breakpoint
CREATE TABLE "calendar_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"start_day" date NOT NULL,
	"start_time" time,
	"end_day" date,
	"end_time" time,
	"repeat" text,
	"skip_days" date[] DEFAULT '{}'::date[] NOT NULL,
	"remind" "calendar_remind",
	"reminded_day" date,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_event_person" (
	"event_id" integer NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "calendar_event_person_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_person" ADD CONSTRAINT "calendar_event_person_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_person" ADD CONSTRAINT "calendar_event_person_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_start_idx" ON "calendar_event" USING btree ("start_day");