ALTER TABLE "episode_label" DROP CONSTRAINT "episode_label_episode_id_label_pk";--> statement-breakpoint
ALTER TABLE "episode_label" ALTER COLUMN "set_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "label_job" ALTER COLUMN "set_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_label" ADD CONSTRAINT "episode_label_episode_id_set_id_label_pk" PRIMARY KEY("episode_id","set_id","label");