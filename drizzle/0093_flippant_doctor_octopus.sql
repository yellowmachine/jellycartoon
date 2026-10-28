CREATE TABLE "expense_favorite" (
	"id" serial PRIMARY KEY NOT NULL,
	"store" text NOT NULL,
	"category" text NOT NULL,
	"total" integer,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_favorite" ADD CONSTRAINT "expense_favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;