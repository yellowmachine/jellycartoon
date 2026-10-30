/**
 * Better Auth's paths closed over HTTP (auth.ts); `auth.api`, from the server, still has them.
 * Nobody asks for a password reset by email yet: there is no email. `/token`, the jwt plugin's:
 * the houses get theirs from `/oauth2/token`, the provider's (as its docs ask). And signing up
 * only from an invitation's page (/invitacion/<token>), which checks its token (#287): open, an
 * invited email, if known, could be taken by anyone, before the invited person.
 */
export const DISABLED_PATHS = [
	'/request-password-reset',
	'/reset-password',
	'/token',
	'/sign-up/email'
];
