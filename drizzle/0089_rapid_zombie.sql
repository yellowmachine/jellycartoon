CREATE TYPE "public"."alarm_action" AS ENUM('sonar', 'parar_musica');--> statement-breakpoint
CREATE TYPE "public"."alarm_kind" AS ENUM('temporizador', 'alarma');--> statement-breakpoint
CREATE TABLE "alarm" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"kind" "alarm_kind" NOT NULL,
	"ends_at" timestamp,
	"time" time,
	"start_day" date,
	"repeat" text,
	"skip_days" date[] DEFAULT '{}'::date[] NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"next_at" timestamp,
	"action" "alarm_action" DEFAULT 'sonar' NOT NULL,
	"place" text DEFAULT 'casa' NOT NULL,
	"ringing_since" timestamp,
	"done_at" timestamp,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alarm_person" (
	"alarm_id" integer NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "alarm_person_alarm_id_user_id_pk" PRIMARY KEY("alarm_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "alarm" ADD CONSTRAINT "alarm_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm_person" ADD CONSTRAINT "alarm_person_alarm_id_alarm_id_fk" FOREIGN KEY ("alarm_id") REFERENCES "public"."alarm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm_person" ADD CONSTRAINT "alarm_person_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alarm_next_idx" ON "alarm" USING btree ("next_at");