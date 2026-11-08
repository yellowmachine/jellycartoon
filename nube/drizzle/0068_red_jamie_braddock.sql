CREATE TABLE "offline_game" (
	"family_id" text NOT NULL,
	"system" text NOT NULL,
	"file" text NOT NULL,
	"device_id" text NOT NULL,
	"title" text NOT NULL,
	"state" "offline_list_state" DEFAULT 'pending' NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"problem" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offline_game_system_file_device_id_pk" PRIMARY KEY("system","file","device_id")
);
--> statement-breakpoint
ALTER TABLE "offline_game" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offline_game" ADD CONSTRAINT "offline_game_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_game" ADD CONSTRAINT "offline_game_device_fk" FOREIGN KEY ("family_id","device_id") REFERENCES "public"."map_device"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "offline_game_own" ON "offline_game" AS PERMISSIVE FOR ALL TO public USING ("offline_game"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("offline_game"."family_id" = nullif(current_setting('app.family_id', true), ''));