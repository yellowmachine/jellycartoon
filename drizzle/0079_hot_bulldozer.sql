CREATE TABLE "dj_preset" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"options" jsonb NOT NULL,
	CONSTRAINT "dj_preset_user_name" UNIQUE("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "dj_preset" ADD CONSTRAINT "dj_preset_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;