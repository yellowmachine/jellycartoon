CREATE TABLE "podcast" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"feed_url" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"description" text,
	"image_url" text,
	"link" text,
	"checked_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_family_id" UNIQUE("family_id","id"),
	CONSTRAINT "podcast_feed_unique" UNIQUE("family_id","feed_url")
);
--> statement-breakpoint
ALTER TABLE "podcast" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "podcast_episode" (
	"family_id" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"podcast_id" integer NOT NULL,
	"guid" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"audio_url" text NOT NULL,
	"duration_sec" integer,
	"published_at" timestamp,
	"image_url" text,
	CONSTRAINT "podcast_episode_family_id" UNIQUE("family_id","id"),
	CONSTRAINT "podcast_episode_guid_unique" UNIQUE("podcast_id","guid")
);
--> statement-breakpoint
ALTER TABLE "podcast_episode" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "podcast_progress" (
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"episode_id" integer NOT NULL,
	"position_sec" real NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_progress_user_id_episode_id_pk" PRIMARY KEY("user_id","episode_id")
);
--> statement-breakpoint
ALTER TABLE "podcast_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "podcast_subscription" (
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"podcast_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_subscription_user_id_podcast_id_pk" PRIMARY KEY("user_id","podcast_id")
);
--> statement-breakpoint
ALTER TABLE "podcast_subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast" ADD CONSTRAINT "podcast_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_episode" ADD CONSTRAINT "podcast_episode_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_episode" ADD CONSTRAINT "podcast_episode_podcast_fk" FOREIGN KEY ("family_id","podcast_id") REFERENCES "public"."podcast"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_progress" ADD CONSTRAINT "podcast_progress_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_progress" ADD CONSTRAINT "podcast_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_progress" ADD CONSTRAINT "podcast_progress_episode_fk" FOREIGN KEY ("family_id","episode_id") REFERENCES "public"."podcast_episode"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_subscription" ADD CONSTRAINT "podcast_subscription_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_subscription" ADD CONSTRAINT "podcast_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_subscription" ADD CONSTRAINT "podcast_subscription_podcast_fk" FOREIGN KEY ("family_id","podcast_id") REFERENCES "public"."podcast"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "podcast_episode_published_idx" ON "podcast_episode" USING btree ("podcast_id","published_at");--> statement-breakpoint
CREATE POLICY "podcast_own" ON "podcast" AS PERMISSIVE FOR ALL TO public USING ("podcast"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("podcast"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "podcast_episode_own" ON "podcast_episode" AS PERMISSIVE FOR ALL TO public USING ("podcast_episode"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("podcast_episode"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "podcast_progress_own" ON "podcast_progress" AS PERMISSIVE FOR ALL TO public USING ("podcast_progress"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("podcast_progress"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "podcast_subscription_own" ON "podcast_subscription" AS PERMISSIVE FOR ALL TO public USING ("podcast_subscription"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("podcast_subscription"."family_id" = nullif(current_setting('app.family_id', true), ''));