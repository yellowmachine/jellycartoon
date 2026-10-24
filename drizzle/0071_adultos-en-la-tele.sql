CREATE TABLE "tv_login_request" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"state" "kid_login_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "tv_login_request_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "tv_login_request" ADD CONSTRAINT "tv_login_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_login_request" ADD CONSTRAINT "tv_login_request_device_id_trusted_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."trusted_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tv_login_request_device_idx" ON "tv_login_request" USING btree ("device_id","created_at");