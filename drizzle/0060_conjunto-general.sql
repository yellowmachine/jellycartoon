-- Custom SQL migration file, put your code below! ---- The one list of labels there was (Ajustes → Casa), as the set «General»; what was labelled and
-- what waits, with it. Without a list, nothing could have been labelled.
INSERT INTO "label_set" ("name", "labels")
SELECT 'General', "value" FROM "app_setting" WHERE "key" = 'episode_labels';
--> statement-breakpoint
UPDATE "episode_label" SET "set_id" = (SELECT "id" FROM "label_set" WHERE "name" = 'General');
--> statement-breakpoint
UPDATE "label_job" SET "set_id" = (SELECT "id" FROM "label_set" WHERE "name" = 'General');
--> statement-breakpoint
DELETE FROM "episode_label" WHERE "set_id" IS NULL;
--> statement-breakpoint
DELETE FROM "label_job" WHERE "set_id" IS NULL;
--> statement-breakpoint
DELETE FROM "app_setting" WHERE "key" = 'episode_labels';
