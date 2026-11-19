CREATE TABLE "msg_backup" (
	"user_id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"oprf_key" text NOT NULL,
	"verifier" text,
	"blob" text,
	"tries" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "msg_backup" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "msg_backup" ADD CONSTRAINT "msg_backup_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msg_backup" ADD CONSTRAINT "msg_backup_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "msg_backup_own" ON "msg_backup" AS PERMISSIVE FOR ALL TO public USING ("msg_backup"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("msg_backup"."family_id" = nullif(current_setting('app.family_id', true), ''));