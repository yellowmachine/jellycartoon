-- Custom SQL migration file, put your code below! --
-- Whoever accepted an invitation opened the link sent to that email: it is theirs. Done on
-- accepting since 4e0b7a8 (invitation-scope.ts); this, for those who accepted before, so that the
-- apps entering with the cloud's account (#284, Librarian) see their email as verified.
UPDATE "user" SET "email_verified" = true
WHERE NOT "email_verified"
	AND EXISTS (
		SELECT 1 FROM "invitation"
		WHERE lower("invitation"."email") = lower("user"."email") AND "invitation"."used_at" IS NOT NULL
	);
