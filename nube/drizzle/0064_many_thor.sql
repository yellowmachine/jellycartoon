CREATE TABLE "miniflux_link" (
	"user_id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "miniflux_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_data_key" (
	"user_id" text PRIMARY KEY NOT NULL,
	"wrapped" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_data_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_secret" (
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_secret_user_id_name_pk" PRIMARY KEY("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "user_secret" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "miniflux_link" ADD CONSTRAINT "miniflux_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_data_key" ADD CONSTRAINT "user_data_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_secret" ADD CONSTRAINT "user_secret_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "miniflux_link_own" ON "miniflux_link" AS PERMISSIVE FOR ALL TO public USING ("miniflux_link"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("miniflux_link"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "user_data_key_own" ON "user_data_key" AS PERMISSIVE FOR ALL TO public USING ("user_data_key"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("user_data_key"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "user_secret_own" ON "user_secret" AS PERMISSIVE FOR ALL TO public USING ("user_secret"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("user_secret"."user_id" = nullif(current_setting('app.user_id', true), ''));