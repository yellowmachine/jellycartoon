/**
 * The second step (a code from an app after the password): whoever wants it turns it on in
 * Ajustes, and the administrator, who can change everything in the house, always has it. The first
 * time they sign in without it, that session can only set it up (`/verificacion`): sessions opened
 * before are left as they were, so the living room's TV is not thrown out.
 */

export const SETUP_PATH = '/verificacion';

/** Where a session that must set it up can go: the page to do it, and leaving. */
const SETUP_PATHS = [SETUP_PATH, '/logout', '/api/auth', '/api/health'];

export const allowedWhileSettingUp = (pathname: string) =>
	SETUP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** A session that has to set up its second step before anything else. */
export const mustSetUp = (
	sessionRow: { twoFactorSetup?: boolean | null } | undefined,
	user: { twoFactorEnabled?: boolean | null } | undefined
) => Boolean(sessionRow?.twoFactorSetup && !user?.twoFactorEnabled);
