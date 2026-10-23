import { ORIGIN, BETTER_AUTH_SECRET, ALLOW_SIGNUP } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '#lib/server/db/index.ts';

const ac = createAccessControl(defaultStatements);

export const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { enabled: true, disableSignUp: !ALLOW_SIGNUP },
	session: {
		additionalFields: {
			/**
			 * Signed in with the password by the administrator, who has no second step yet (#82, #45):
			 * this session only goes to /verificacion until it has one. Sessions opened before are left
			 * as they were, so the living room's is not thrown out.
			 */
			twoFactorSetup: { type: 'boolean', defaultValue: false, input: false },
			/**
			 * A child who enters with a parent's permission (#141): opened by the server once one of
			 * its parents or guardians said yes (kid-login.ts). Such a child's session without it was
			 * opened some other way, and is refused (hooks.server.ts).
			 */
			kidApproved: { type: 'boolean', defaultValue: false, input: false }
		}
	},
	plugins: [
		// Only for the role: «infantil» (#17), given when the account is created from Ajustes and that
		// the account itself cannot change.
		admin({
			ac,
			roles: { admin: adminAc, user: userAc, infantil: ac.newRole({ user: [], session: [] }) }
		}),
		// A code from an app (Proton Pass, Google Authenticator…) after the password, for whoever turns
		// it on in Ajustes and always for the administrator; 10 recovery codes for a lost phone. A
		// trusted device is not asked again for 90 days.
		twoFactor({ issuer: 'JellyCartoon', trustDeviceMaxAge: 90 * 24 * 60 * 60 }),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
