CREATE TYPE "public"."route_map_state" AS ENUM('pending', 'downloading', 'ready', 'failed', 'remove');--> statement-breakpoint
CREATE TABLE "map_device" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_map" (
	"route_id" integer NOT NULL,
	"device_id" text NOT NULL,
	"state" "route_map_state" DEFAULT 'pending' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"bytes" bigint,
	"version" text,
	"problem" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "route_map_route_id_device_id_pk" PRIMARY KEY("route_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "map_device" ADD CONSTRAINT "map_device_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_map" ADD CONSTRAINT "route_map_route_id_saved_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."saved_route"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_map" ADD CONSTRAINT "route_map_device_id_map_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."map_device"("id") ON DELETE cascade ON UPDATE no action;