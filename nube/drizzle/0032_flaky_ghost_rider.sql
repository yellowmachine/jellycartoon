CREATE TYPE "public"."kid_request_state" AS ENUM('pending', 'approved', 'denied', 'used');--> statement-breakpoint
CREATE TABLE "kid_login_request" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"kid_id" text NOT NULL,
	"device_id" integer NOT NULL,
	"state" "kid_request_state" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"decided_by" text,
	"until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kid_login_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kid_permit" (
	"family_id" text NOT NULL,
	"kid_id" text NOT NULL,
	"device_id" integer NOT NULL,
	"until" timestamp NOT NULL,
	"granted_by" text,
	CONSTRAINT "kid_permit_kid_id_device_id_pk" PRIMARY KEY("kid_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "kid_permit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trusted_device" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_device_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "trusted_device" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kid_login_request" ADD CONSTRAINT "kid_login_request_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_login_request" ADD CONSTRAINT "kid_login_request_kid_id_user_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_login_request" ADD CONSTRAINT "kid_login_request_device_id_trusted_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."trusted_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_login_request" ADD CONSTRAINT "kid_login_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_permit" ADD CONSTRAINT "kid_permit_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_permit" ADD CONSTRAINT "kid_permit_kid_id_user_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_permit" ADD CONSTRAINT "kid_permit_device_id_trusted_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."trusted_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_permit" ADD CONSTRAINT "kid_permit_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kid_login_request_device_idx" ON "kid_login_request" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE POLICY "kid_login_request_own" ON "kid_login_request" AS PERMISSIVE FOR ALL TO public USING ("kid_login_request"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("kid_login_request"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "kid_permit_own" ON "kid_permit" AS PERMISSIVE FOR ALL TO public USING ("kid_permit"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("kid_permit"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "trusted_device_own" ON "trusted_device" AS PERMISSIVE FOR ALL TO public USING ("trusted_device"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("trusted_device"."family_id" = nullif(current_setting('app.family_id', true), ''));