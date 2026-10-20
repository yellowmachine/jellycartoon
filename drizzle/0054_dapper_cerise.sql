CREATE TABLE "episode_quotes" (
	"episode_id" integer PRIMARY KEY NOT NULL,
	"file" text NOT NULL,
	"quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "opening_quote" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_quotes" ADD CONSTRAINT "episode_quotes_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;