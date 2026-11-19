CREATE TABLE "msg_conversation" (
	"id" text NOT NULL,
	"family_id" text NOT NULL,
	"kind" text NOT NULL,
	"home_family_id" text NOT NULL,
	"epoch" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "msg_conversation_id_family_id_pk" PRIMARY KEY("id","family_id")
);
--> statement-breakpoint
ALTER TABLE "msg_conversation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "msg_device" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"seen_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "msg_device" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "msg_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"kind" text NOT NULL,
	"epoch" integer NOT NULL,
	"sender_device" text NOT NULL,
	"recipients" jsonb,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "msg_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "msg_key_package" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"device_id" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "msg_key_package" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "msg_member" (
	"conversation_id" text NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "msg_member_conversation_id_family_id_user_id_pk" PRIMARY KEY("conversation_id","family_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "msg_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "msg_conversation" ADD CONSTRAINT "msg_conversation_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msg_device" ADD CONSTRAINT "msg_device_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msg_device" ADD CONSTRAINT "msg_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msg_event" ADD CONSTRAINT "msg_event_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msg_key_package" ADD CONSTRAINT "msg_key_package_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msg_key_package" ADD CONSTRAINT "msg_key_package_device_id_msg_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."msg_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msg_member" ADD CONSTRAINT "msg_member_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msg_member" ADD CONSTRAINT "msg_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "msg_device_user_idx" ON "msg_device" USING btree ("family_id","user_id");--> statement-breakpoint
CREATE INDEX "msg_event_family_idx" ON "msg_event" USING btree ("family_id","id");--> statement-breakpoint
CREATE INDEX "msg_event_conversation_idx" ON "msg_event" USING btree ("family_id","conversation_id","id");--> statement-breakpoint
CREATE INDEX "msg_key_package_device_idx" ON "msg_key_package" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "msg_member_user_idx" ON "msg_member" USING btree ("family_id","user_id");--> statement-breakpoint
CREATE POLICY "msg_conversation_own" ON "msg_conversation" AS PERMISSIVE FOR ALL TO public USING ("msg_conversation"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("msg_conversation"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "msg_device_own" ON "msg_device" AS PERMISSIVE FOR ALL TO public USING ("msg_device"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("msg_device"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "msg_event_own" ON "msg_event" AS PERMISSIVE FOR ALL TO public USING ("msg_event"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("msg_event"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "msg_key_package_own" ON "msg_key_package" AS PERMISSIVE FOR ALL TO public USING ("msg_key_package"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("msg_key_package"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "msg_member_own" ON "msg_member" AS PERMISSIVE FOR ALL TO public USING ("msg_member"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("msg_member"."family_id" = nullif(current_setting('app.family_id', true), ''));