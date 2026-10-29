CREATE TABLE "unsent_ai_cost" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp NOT NULL,
	"label" text NOT NULL,
	"cost" double precision NOT NULL,
	"error" text NOT NULL,
	"tries" integer DEFAULT 1 NOT NULL,
	"tried_at" timestamp DEFAULT now() NOT NULL
);
