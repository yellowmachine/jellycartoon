DROP TABLE "map_device" CASCADE;--> statement-breakpoint
DROP TABLE "route_map" CASCADE;--> statement-breakpoint
DROP TABLE "saved_place" CASCADE;--> statement-breakpoint
DROP TABLE "saved_route" CASCADE;--> statement-breakpoint
DROP TABLE "trip" CASCADE;--> statement-breakpoint
DROP TABLE "trip_photo" CASCADE;--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "record_trips";--> statement-breakpoint
DROP TYPE "public"."route_map_state";