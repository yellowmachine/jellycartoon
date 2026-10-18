ALTER TABLE "movie_info" ADD COLUMN "awards" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "movie_info" ADD COLUMN "sagas" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "movie_info" ADD COLUMN "writers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "movie_info" ADD COLUMN "composers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "movie_info" ADD COLUMN "cinematographers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "movie_info" ADD COLUMN "black_and_white" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "movie_info" ADD COLUMN "silent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "movie_info" ADD COLUMN "details_version" integer DEFAULT 0 NOT NULL;