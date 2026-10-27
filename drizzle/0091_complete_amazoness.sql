CREATE TABLE "telegram_account" (
	"user_id" text PRIMARY KEY NOT NULL,
	"api_id" integer NOT NULL,
	"api_hash" text NOT NULL,
	"session" text NOT NULL,
	"name" text,
	"groups" boolean DEFAULT false NOT NULL,
	"mark_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_account" ADD CONSTRAINT "telegram_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;