CREATE TABLE "kid_companion" (
	"kid_id" text NOT NULL,
	"companion_id" text NOT NULL,
	"session_id" text NOT NULL,
	"added_by" text,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"until" timestamp NOT NULL,
	CONSTRAINT "kid_companion_kid_id_companion_id_pk" PRIMARY KEY("kid_id","companion_id")
);
--> statement-breakpoint
ALTER TABLE "kid_login_request" ADD COLUMN "companions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "kid_companion" ADD CONSTRAINT "kid_companion_kid_id_user_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_companion" ADD CONSTRAINT "kid_companion_companion_id_user_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_companion" ADD CONSTRAINT "kid_companion_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_companion" ADD CONSTRAINT "kid_companion_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;