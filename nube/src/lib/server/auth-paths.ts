/**
 * Better Auth's paths closed over HTTP (auth.ts); `auth.api`, from the server, still has them.
 * A password reset only from its pages (/login/olvidada, /login/nueva), with their own limit
 * (password-reset.ts). `/token`, the jwt plugin's:
 * the houses get theirs from `/oauth2/token`, the provider's (as its docs ask). And signing up
 * only from an invitation's page (/invitacion/<token>), which checks its token (#287): open, an
 * invited email, if known, could be taken by anyone, before the invited person. Deleting an
 * account only from its page (/cuenta/eliminar): its GET, opened by whatever reads an email, would
 * delete it.
 */
export const DISABLED_PATHS = [
	'/request-password-reset',
	'/reset-password',
	'/token',
	'/sign-up/email',
	'/delete-user',
	'/delete-user/callback'
];
