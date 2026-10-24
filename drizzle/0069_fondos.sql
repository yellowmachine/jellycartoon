ALTER TABLE "movie" ADD COLUMN "backdrop_sec" real;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "backdrop_episode_id" integer;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "backdrop_sec" real;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_backdrop_episode_id_episode_id_fk" FOREIGN KEY ("backdrop_episode_id") REFERENCES "public"."episode"("id") ON DELETE set null ON UPDATE no action;