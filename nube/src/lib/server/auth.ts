import { ORIGIN, BETTER_AUTH_SECRET } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '#lib/server/db/index.ts';
import { invitationFor, joinInvitedFamily } from '#lib/server/family.ts';

export const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { enabled: true, minPasswordLength: 10 },
	// Nobody asks for a password reset by email yet: there is no email.
	disabledPaths: ['/request-password-reset', '/reset-password'],
	hooks: {
		/** Only who was invited signs up (scripts/crear-familia.ts): the app is on the internet. */
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path !== '/sign-up/email') return;
			const email = String(ctx.body?.email ?? '');
			if (!(await invitationFor(email)))
				throw new APIError('FORBIDDEN', {
					message: 'Ese email no tiene invitación: pídesela a quien administra tu familia'
				});
		})
	},
	databaseHooks: {
		user: {
			create: {
				/** Into the family it was invited to, as soon as the account exists. */
				after: (user) => joinInvitedFamily(user.id, user.email)
			}
		}
	},
	/** 30 days, renewed while used, as jellycartoon's. */
	session: { expiresIn: 30 * 24 * 60 * 60 },
	plugins: [
		// A code from an app (Proton Pass, Aegis…) after the password, for whoever turns it on in
		// Ajustes; 10 recovery codes for a lost phone. A trusted device is not asked for 90 days.
		twoFactor({ issuer: 'Nube', trustDeviceMaxAge: 90 * 24 * 60 * 60 }),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
