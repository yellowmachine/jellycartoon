import { eq } from 'drizzle-orm';
import { isAdmin } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import { session } from '#lib/server/db/schema.ts';
import { isKid } from '#lib/server/kids.ts';

export { allowedWhileSettingUp, mustSetUp, SETUP_PATH } from '#lib/two-factor.ts';

/** Children's accounts have no second step: the administrator makes them, for the TV. */
export const canUseTwoFactor = (user: { role?: string | null } | undefined) => !isKid(user);

/** The administrator must always have it: they cannot turn it off. */
export const mustHaveTwoFactor = (userId: string) => isAdmin(userId);

/** Just signed in with the password: if it is the administrator without it, this session sets it up. */
export async function markSetupIfNeeded(
	user: { id: string; twoFactorEnabled?: boolean | null },
	sessionToken: string
) {
	if (user.twoFactorEnabled || !(await mustHaveTwoFactor(user.id))) return false;
	await db.update(session).set({ twoFactorSetup: true }).where(eq(session.token, sessionToken));
	return true;
}
