CREATE TABLE "podcast" (
	"id" serial PRIMARY KEY NOT NULL,
	"feed_url" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"description" text,
	"image_url" text,
	"link" text,
	"checked_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_feed_url_unique" UNIQUE("feed_url")
);
--> statement-breakpoint
CREATE TABLE "podcast_episode" (
	"id" serial PRIMARY KEY NOT NULL,
	"podcast_id" integer NOT NULL,
	"guid" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"audio_url" text NOT NULL,
	"duration_sec" integer,
	"published_at" timestamp,
	"image_url" text,
	CONSTRAINT "podcast_episode_guid_unique" UNIQUE("podcast_id","guid")
);
--> statement-breakpoint
CREATE TABLE "podcast_progress" (
	"user_id" text NOT NULL,
	"episode_id" integer NOT NULL,
	"position_sec" real NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_progress_user_id_episode_id_pk" PRIMARY KEY("user_id","episode_id")
);
--> statement-breakpoint
CREATE TABLE "podcast_subscription" (
	"user_id" text NOT NULL,
	"podcast_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_subscription_user_id_podcast_id_pk" PRIMARY KEY("user_id","podcast_id")
);
--> statement-breakpoint
ALTER TABLE "music_queue" ADD COLUMN "podcast_episode_id" integer;--> statement-breakpoint
ALTER TABLE "podcast_episode" ADD CONSTRAINT "podcast_episode_podcast_id_podcast_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_progress" ADD CONSTRAINT "podcast_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_progress" ADD CONSTRAINT "podcast_progress_episode_id_podcast_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."podcast_episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_subscription" ADD CONSTRAINT "podcast_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_subscription" ADD CONSTRAINT "podcast_subscription_podcast_id_podcast_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "podcast_episode_published_idx" ON "podcast_episode" USING btree ("podcast_id","published_at");--> statement-breakpoint
ALTER TABLE "music_queue" ADD CONSTRAINT "music_queue_podcast_episode_id_podcast_episode_id_fk" FOREIGN KEY ("podcast_episode_id") REFERENCES "public"."podcast_episode"("id") ON DELETE set null ON UPDATE no action;