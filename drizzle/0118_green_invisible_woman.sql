CREATE TABLE "replica_state" (
	"shape" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"offset" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "series_tag" DROP CONSTRAINT "series_tag_series_id_series_id_fk";
--> statement-breakpoint
ALTER TABLE "series_tag" DROP CONSTRAINT "series_tag_tag_id_tag_id_fk";
