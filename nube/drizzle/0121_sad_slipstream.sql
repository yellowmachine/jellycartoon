ALTER TABLE "walk_photo" DROP CONSTRAINT "walk_photo_walk_id_walk_id_fk";
--> statement-breakpoint
ALTER TABLE "walk_photo" ALTER COLUMN "walk_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "walk_photo" ADD CONSTRAINT "walk_photo_walk_id_walk_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walk"("id") ON DELETE set null ON UPDATE no action;