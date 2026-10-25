CREATE TABLE "game_controls" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"system" text NOT NULL,
	"controls" jsonb NOT NULL,
	CONSTRAINT "game_controls_user_system" UNIQUE("user_id","system")
);
--> statement-breakpoint
ALTER TABLE "game_controls" ADD CONSTRAINT "game_controls_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;