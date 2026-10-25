CREATE TABLE "game_cartridge" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"game_id" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_cartridge_user_game" UNIQUE("user_id","game_id")
);
--> statement-breakpoint
ALTER TABLE "game_cartridge" ADD CONSTRAINT "game_cartridge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_cartridge" ADD CONSTRAINT "game_cartridge_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;