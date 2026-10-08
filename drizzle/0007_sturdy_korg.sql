CREATE TABLE "user_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_list_item" (
	"list_id" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"position" integer NOT NULL,
	"watched" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_list_item_list_id_episode_id_pk" PRIMARY KEY("list_id","episode_id")
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "active_list_id" integer;--> statement-breakpoint
ALTER TABLE "user_list" ADD CONSTRAINT "user_list_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_list_item" ADD CONSTRAINT "user_list_item_list_id_user_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."user_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_list_item" ADD CONSTRAINT "user_list_item_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_list_user_idx" ON "user_list" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_active_list_id_user_list_id_fk" FOREIGN KEY ("active_list_id") REFERENCES "public"."user_list"("id") ON DELETE set null ON UPDATE no action;