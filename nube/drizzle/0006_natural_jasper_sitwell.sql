CREATE TYPE "public"."alarm_action" AS ENUM('sonar', 'parar_musica');--> statement-breakpoint
CREATE TYPE "public"."calendar_remind" AS ENUM('hora', 'dia');--> statement-breakpoint
CREATE TABLE "agenda_link" (
	"family_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	CONSTRAINT "agenda_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "agenda_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alarm" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"label" text NOT NULL,
	"time" time NOT NULL,
	"start_day" date NOT NULL,
	"repeat" text,
	"skip_days" date[] DEFAULT '{}'::date[] NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"next_at" timestamp,
	"action" "alarm_action" DEFAULT 'sonar' NOT NULL,
	"place" text DEFAULT 'casa' NOT NULL,
	"ringing_since" timestamp,
	"done_at" timestamp,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "alarm_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "alarm" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alarm_person" (
	"family_id" text NOT NULL,
	"alarm_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	CONSTRAINT "alarm_person_alarm_id_person_id_pk" PRIMARY KEY("alarm_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "alarm_person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "calendar_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "calendar_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "calendar_event_person" (
	"family_id" text NOT NULL,
	"event_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	CONSTRAINT "calendar_event_person_event_id_person_id_pk" PRIMARY KEY("event_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_event_person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "family_person" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"avatar" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "family_person_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "family_person_family_id" UNIQUE("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "family_person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agenda_link" ADD CONSTRAINT "agenda_link_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm" ADD CONSTRAINT "alarm_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm" ADD CONSTRAINT "alarm_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm_person" ADD CONSTRAINT "alarm_person_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm_person" ADD CONSTRAINT "alarm_person_alarm_fk" FOREIGN KEY ("family_id","alarm_id") REFERENCES "public"."alarm"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm_person" ADD CONSTRAINT "alarm_person_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."family_person"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_person" ADD CONSTRAINT "calendar_event_person_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_person" ADD CONSTRAINT "calendar_event_person_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."calendar_event"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_person" ADD CONSTRAINT "calendar_event_person_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."family_person"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_person" ADD CONSTRAINT "family_person_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_person" ADD CONSTRAINT "family_person_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alarm_next_idx" ON "alarm" USING btree ("next_at");--> statement-breakpoint
CREATE INDEX "calendar_event_start_idx" ON "calendar_event" USING btree ("family_id","start_day");--> statement-breakpoint
CREATE INDEX "family_person_family_idx" ON "family_person" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "push_subscription_user_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "agenda_link_own" ON "agenda_link" AS PERMISSIVE FOR ALL TO public USING ("agenda_link"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("agenda_link"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "agenda_link_by_token" ON "agenda_link" AS PERMISSIVE FOR SELECT TO public USING ("agenda_link"."token" = nullif(current_setting('app.ics_token', true), ''));--> statement-breakpoint
CREATE POLICY "alarm_own" ON "alarm" AS PERMISSIVE FOR ALL TO public USING ("alarm"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("alarm"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "alarm_person_own" ON "alarm_person" AS PERMISSIVE FOR ALL TO public USING ("alarm_person"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("alarm_person"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "calendar_event_own" ON "calendar_event" AS PERMISSIVE FOR ALL TO public USING ("calendar_event"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("calendar_event"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "calendar_event_person_own" ON "calendar_event_person" AS PERMISSIVE FOR ALL TO public USING ("calendar_event_person"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("calendar_event_person"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "family_person_own" ON "family_person" AS PERMISSIVE FOR ALL TO public USING ("family_person"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("family_person"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "push_subscription_own" ON "push_subscription" AS PERMISSIVE FOR ALL TO public USING ("push_subscription"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("push_subscription"."family_id" = nullif(current_setting('app.family_id', true), ''));