CREATE TABLE "tv_shortcut" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tv_shortcut_tag" (
	"shortcut_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "tv_shortcut_tag_shortcut_id_tag_id_pk" PRIMARY KEY("shortcut_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "watch_time" DROP CONSTRAINT "watch_time_user_day_item";--> statement-breakpoint
ALTER TABLE "watch_time" DROP CONSTRAINT "watch_time_one_item";--> statement-breakpoint
ALTER TABLE "watch_time" ADD COLUMN "shortcut_id" integer;--> statement-breakpoint
ALTER TABLE "tv_shortcut_tag" ADD CONSTRAINT "tv_shortcut_tag_shortcut_id_tv_shortcut_id_fk" FOREIGN KEY ("shortcut_id") REFERENCES "public"."tv_shortcut"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_shortcut_tag" ADD CONSTRAINT "tv_shortcut_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tv_shortcut_tag_tag_idx" ON "tv_shortcut_tag" USING btree ("tag_id");--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_shortcut_id_tv_shortcut_id_fk" FOREIGN KEY ("shortcut_id") REFERENCES "public"."tv_shortcut"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_user_day_item" UNIQUE NULLS NOT DISTINCT("user_id","day","minute","episode_id","movie_id","channel_id","shortcut_id");--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_one_item" CHECK (num_nonnulls("watch_time"."episode_id", "watch_time"."movie_id", "watch_time"."channel_id", "watch_time"."shortcut_id") = 1);