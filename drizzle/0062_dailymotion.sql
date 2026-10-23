CREATE TYPE "public"."dailymotion_source_kind" AS ENUM('user', 'playlist');--> statement-breakpoint
CREATE TABLE "dailymotion_progress" (
	"user_id" text NOT NULL,
	"video_xid" text NOT NULL,
	"position_sec" real NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dailymotion_progress_user_id_video_xid_pk" PRIMARY KEY("user_id","video_xid")
);
--> statement-breakpoint
CREATE TABLE "dailymotion_source" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "dailymotion_source_kind" NOT NULL,
	"xid" text NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"added_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dailymotion_source_kind_xid" UNIQUE("kind","xid")
);
--> statement-breakpoint
CREATE TABLE "dailymotion_video" (
	"xid" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"owner" text NOT NULL,
	"duration_sec" real,
	"thumbnail" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_time" DROP CONSTRAINT "watch_time_user_day_item";--> statement-breakpoint
ALTER TABLE "watch_time" DROP CONSTRAINT "watch_time_one_item";--> statement-breakpoint
ALTER TABLE "watch_time" ADD COLUMN "dailymotion_id" text;--> statement-breakpoint
ALTER TABLE "dailymotion_progress" ADD CONSTRAINT "dailymotion_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dailymotion_progress" ADD CONSTRAINT "dailymotion_progress_video_xid_dailymotion_video_xid_fk" FOREIGN KEY ("video_xid") REFERENCES "public"."dailymotion_video"("xid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dailymotion_source" ADD CONSTRAINT "dailymotion_source_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_dailymotion_id_dailymotion_video_xid_fk" FOREIGN KEY ("dailymotion_id") REFERENCES "public"."dailymotion_video"("xid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_user_day_item" UNIQUE NULLS NOT DISTINCT("user_id","day","minute","episode_id","movie_id","channel_id","dailymotion_id");--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_one_item" CHECK (num_nonnulls("watch_time"."episode_id", "watch_time"."movie_id", "watch_time"."channel_id", "watch_time"."dailymotion_id") = 1);