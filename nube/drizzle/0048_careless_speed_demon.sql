CREATE TYPE "public"."offline_list_state" AS ENUM('pending', 'downloading', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "offline_list" (
	"family_id" text NOT NULL,
	"playlist_id" integer NOT NULL,
	"device_id" text NOT NULL,
	"name" text NOT NULL,
	"state" "offline_list_state" DEFAULT 'pending' NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"problem" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offline_list_playlist_id_device_id_pk" PRIMARY KEY("playlist_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "offline_list" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offline_list" ADD CONSTRAINT "offline_list_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_list" ADD CONSTRAINT "offline_list_device_fk" FOREIGN KEY ("family_id","device_id") REFERENCES "public"."map_device"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "offline_list_own" ON "offline_list" AS PERMISSIVE FOR ALL TO public USING ("offline_list"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("offline_list"."family_id" = nullif(current_setting('app.family_id', true), ''));