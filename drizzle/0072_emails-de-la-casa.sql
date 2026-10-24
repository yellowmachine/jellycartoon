-- Custom SQL migration file, put your code below! ---- The house's emails are the administrator's word (#172): nobody signs up but the first account,
-- and the administrator creates the rest. As verified, Better Auth's magic link (with which an
-- adult enters on the TV from their phone) does not take an unverified account's password away.
UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false;
