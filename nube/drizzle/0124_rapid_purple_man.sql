CREATE TABLE "body_weight" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"kg" real NOT NULL,
	CONSTRAINT "body_weight_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "body_weight" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "body_weight" ADD CONSTRAINT "body_weight_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "body_weight_own" ON "body_weight" AS PERMISSIVE FOR ALL TO public USING ("body_weight"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("body_weight"."user_id" = nullif(current_setting('app.user_id', true), ''));