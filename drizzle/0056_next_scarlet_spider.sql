CREATE TYPE "public"."kid_login_state" AS ENUM('pending', 'approved', 'denied', 'used');--> statement-breakpoint
CREATE TABLE "kid_guardian" (
	"kid_id" text NOT NULL,
	"guardian_id" text NOT NULL,
	CONSTRAINT "kid_guardian_kid_id_guardian_id_pk" PRIMARY KEY("kid_id","guardian_id")
);
--> statement-breakpoint
CREATE TABLE "kid_login_request" (
	"id" text PRIMARY KEY NOT NULL,
	"kid_id" text NOT NULL,
	"device_id" integer NOT NULL,
	"state" "kid_login_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"decided_by" text,
	"until" timestamp
);
--> statement-breakpoint
CREATE TABLE "kid_permit" (
	"kid_id" text NOT NULL,
	"device_id" integer NOT NULL,
	"until" timestamp NOT NULL,
	"granted_by" text,
	CONSTRAINT "kid_permit_kid_id_device_id_pk" PRIMARY KEY("kid_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "kid_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"avatar" text NOT NULL,
	"by_approval" boolean DEFAULT false NOT NULL,
	"secret" text
);
--> statement-breakpoint
CREATE TABLE "trusted_device" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_device_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "kid_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kid_guardian" ADD CONSTRAINT "kid_guardian_kid_id_user_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_guardian" ADD CONSTRAINT "kid_guardian_guardian_id_user_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_login_request" ADD CONSTRAINT "kid_login_request_kid_id_user_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_login_request" ADD CONSTRAINT "kid_login_request_device_id_trusted_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."trusted_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_login_request" ADD CONSTRAINT "kid_login_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_permit" ADD CONSTRAINT "kid_permit_kid_id_user_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_permit" ADD CONSTRAINT "kid_permit_device_id_trusted_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."trusted_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_permit" ADD CONSTRAINT "kid_permit_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_profile" ADD CONSTRAINT "kid_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kid_guardian_guardian_idx" ON "kid_guardian" USING btree ("guardian_id");--> statement-breakpoint
CREATE INDEX "kid_login_request_device_idx" ON "kid_login_request" USING btree ("device_id","created_at");