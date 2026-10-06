CREATE TABLE "playlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"target_minutes" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "playlist_user_day" UNIQUE("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "playlist_item" (
	"playlist_id" integer NOT NULL,
	"position" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"watched" boolean DEFAULT false NOT NULL,
	CONSTRAINT "playlist_item_playlist_id_position_pk" PRIMARY KEY("playlist_id","position")
);
--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "serialized" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "playlist" ADD CONSTRAINT "playlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_item" ADD CONSTRAINT "playlist_item_playlist_id_playlist_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_item" ADD CONSTRAINT "playlist_item_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;