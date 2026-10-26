CREATE TABLE "steam_game" (
	"appid" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
