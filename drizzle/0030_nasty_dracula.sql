CREATE TABLE "watch_time" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"episode_id" integer,
	"movie_id" integer,
	"seconds" real DEFAULT 0 NOT NULL,
	CONSTRAINT "watch_time_user_day_item" UNIQUE NULLS NOT DISTINCT("user_id","day","episode_id","movie_id"),
	CONSTRAINT "watch_time_one_item" CHECK (("watch_time"."episode_id" is null) <> ("watch_time"."movie_id" is null))
);
--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_time" ADD CONSTRAINT "watch_time_movie_id_movie_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movie"("id") ON DELETE cascade ON UPDATE no action;