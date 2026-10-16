import { ORIGIN, BETTER_AUTH_SECRET, ALLOW_SIGNUP } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '#lib/server/db/index.ts';

const ac = createAccessControl(defaultStatements);

export const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { enabled: true, disableSignUp: !ALLOW_SIGNUP },
	plugins: [
		// Only for the role: «infantil» (#17), given when the account is created from Ajustes and that
		// the account itself cannot change.
		admin({
			ac,
			roles: { admin: adminAc, user: userAc, infantil: ac.newRole({ user: [], session: [] }) }
		}),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
