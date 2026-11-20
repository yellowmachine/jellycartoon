CREATE TABLE "game_source" (
	"family_id" text PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"label" text NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"scanning_since" timestamp,
	"indexed_at" timestamp,
	"games" integer DEFAULT 0 NOT NULL,
	"problem" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_source" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "own_game" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"system" text NOT NULL,
	"file" text NOT NULL,
	"key" text NOT NULL,
	"size" bigint NOT NULL,
	"title" text NOT NULL,
	"full_name" text NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"cover" text,
	"title_screen" text
);
--> statement-breakpoint
ALTER TABLE "own_game" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "own_game_cartridge" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"game_id" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "own_game_cartridge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "own_game_save" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"game_id" integer NOT NULL,
	"has_picture" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "own_game_save" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "own_game_session" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"game_id" integer NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp DEFAULT now() NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "own_game_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family_member" ADD COLUMN "game_source" text;--> statement-breakpoint
ALTER TABLE "game_source" ADD CONSTRAINT "game_source_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_game" ADD CONSTRAINT "own_game_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_game_cartridge" ADD CONSTRAINT "own_game_cartridge_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_game_cartridge" ADD CONSTRAINT "own_game_cartridge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_game_cartridge" ADD CONSTRAINT "own_game_cartridge_game_id_own_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."own_game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_game_save" ADD CONSTRAINT "own_game_save_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_game_save" ADD CONSTRAINT "own_game_save_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_game_save" ADD CONSTRAINT "own_game_save_game_id_own_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."own_game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_game_session" ADD CONSTRAINT "own_game_session_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_game_session" ADD CONSTRAINT "own_game_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_game_session" ADD CONSTRAINT "own_game_session_game_id_own_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."own_game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "own_game_family_system_file" ON "own_game" USING btree ("family_id","system","file");--> statement-breakpoint
CREATE UNIQUE INDEX "own_game_cartridge_user_game" ON "own_game_cartridge" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "own_game_cartridge_game" ON "own_game_cartridge" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "own_game_save_user_game" ON "own_game_save" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "own_game_session_user_game" ON "own_game_session" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE POLICY "game_source_own" ON "game_source" AS PERMISSIVE FOR ALL TO public USING ("game_source"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("game_source"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_game_own" ON "own_game" AS PERMISSIVE FOR ALL TO public USING ("own_game"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("own_game"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_game_cartridge_own" ON "own_game_cartridge" AS PERMISSIVE FOR ALL TO public USING ("own_game_cartridge"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("own_game_cartridge"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_game_save_own" ON "own_game_save" AS PERMISSIVE FOR ALL TO public USING ("own_game_save"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("own_game_save"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_game_session_own" ON "own_game_session" AS PERMISSIVE FOR ALL TO public USING ("own_game_session"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("own_game_session"."family_id" = nullif(current_setting('app.family_id', true), ''));