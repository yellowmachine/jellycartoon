CREATE TYPE "public"."fridge_note_kind" AS ENUM('note', 'list');--> statement-breakpoint
CREATE TABLE "fridge_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" integer NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fridge_note" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "fridge_note_kind" DEFAULT 'note' NOT NULL,
	"user_id" text,
	"text" text NOT NULL,
	"until" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fridge_item" ADD CONSTRAINT "fridge_item_note_id_fridge_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."fridge_note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fridge_item" ADD CONSTRAINT "fridge_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fridge_note" ADD CONSTRAINT "fridge_note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fridge_item_note_idx" ON "fridge_item" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "fridge_note_created_idx" ON "fridge_note" USING btree ("created_at");