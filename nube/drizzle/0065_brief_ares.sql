CREATE TABLE "plug" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"hash" text NOT NULL,
	"device_id" text,
	"model" text,
	"output" boolean,
	"power" real,
	"energy_wh" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	CONSTRAINT "plug_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "plug" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plug_energy" (
	"plug_id" text NOT NULL,
	"family_id" text NOT NULL,
	"hour" timestamp NOT NULL,
	"wh" real DEFAULT 0 NOT NULL,
	CONSTRAINT "plug_energy_plug_id_hour_pk" PRIMARY KEY("plug_id","hour")
);
--> statement-breakpoint
ALTER TABLE "plug_energy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plug" ADD CONSTRAINT "plug_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plug_energy" ADD CONSTRAINT "plug_energy_plug_id_plug_id_fk" FOREIGN KEY ("plug_id") REFERENCES "public"."plug"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plug_energy" ADD CONSTRAINT "plug_energy_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plug_energy_family_hour_idx" ON "plug_energy" USING btree ("family_id","hour");--> statement-breakpoint
CREATE POLICY "plug_own" ON "plug" AS PERMISSIVE FOR ALL TO public USING ("plug"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("plug"."family_id" = nullif(current_setting('app.family_id', true), ''));--> statement-breakpoint
CREATE POLICY "plug_by_hash" ON "plug" AS PERMISSIVE FOR SELECT TO public USING ("plug"."hash" = nullif(current_setting('app.key_hash', true), ''));--> statement-breakpoint
CREATE POLICY "plug_energy_own" ON "plug_energy" AS PERMISSIVE FOR ALL TO public USING ("plug_energy"."family_id" = nullif(current_setting('app.family_id', true), '')) WITH CHECK ("plug_energy"."family_id" = nullif(current_setting('app.family_id', true), ''));