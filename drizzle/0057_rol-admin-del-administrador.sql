-- Custom SQL migration file, put your code below! ---- The app's administrator is the first account created (isAdmin in app-settings.ts). It gets Better
-- Auth's `admin` role too, so that it can set a child's password or credential (#141).
UPDATE "user" SET "role" = 'admin'
WHERE "id" = (SELECT "id" FROM "user" ORDER BY "created_at" ASC LIMIT 1)
	AND ("role" IS NULL OR "role" = 'user');
