CREATE TABLE "music_queue" (
	"user_id" text PRIMARY KEY NOT NULL,
	"track_ids" integer[] NOT NULL,
	"current_index" integer DEFAULT 0 NOT NULL,
	"position_sec" real DEFAULT 0 NOT NULL,
	"shuffle" boolean DEFAULT false NOT NULL,
	"repeat" boolean DEFAULT false NOT NULL,
	"single" boolean DEFAULT false NOT NULL,
	"radio_uuid" text,
	"changed_by" text NOT NULL,
	"updated_at" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "music_queue" ADD CONSTRAINT "music_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;