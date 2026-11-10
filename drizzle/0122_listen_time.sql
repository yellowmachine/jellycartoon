CREATE TABLE "listen_time" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"minute" integer NOT NULL,
	"item" text NOT NULL,
	"kind" text NOT NULL,
	"artist" text,
	"title" text NOT NULL,
	"seconds" real DEFAULT 0 NOT NULL,
	"sent_seconds" real DEFAULT 0 NOT NULL,
	CONSTRAINT "listen_time_slot" UNIQUE("user_id","day","minute","item"),
	CONSTRAINT "listen_time_minute" CHECK ("listen_time"."minute" between 0 and 1439)
);
--> statement-breakpoint
ALTER TABLE "listen_time" ADD CONSTRAINT "listen_time_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;