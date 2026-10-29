import { ORIGIN, BETTER_AUTH_SECRET } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { magicLink } from 'better-auth/plugins/magic-link';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { apiKey } from '@better-auth/api-key';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';
import { INVITATION_SECONDS, markUsed, recordInvitation } from '#lib/server/invitations.ts';
import { keepSignInLink } from '#lib/server/sign-in-links.ts';
import { dropHousePassword, nube, NUBE_PROVIDER } from '#lib/server/nube-login.ts';

const ac = createAccessControl(defaultStatements);

export const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: {
		enabled: true,
		/**
		 * The link to choose one's password (#157): kept for the administrator to give, as a QR or
		 * by WhatsApp, instead of emailed. The person's sessions end when it is used.
		 */
		sendResetPassword: ({ user, token }) => recordInvitation(user.id, token),
		resetPasswordTokenExpiresIn: INVITATION_SECONDS,
		revokeSessionsOnPasswordReset: true,
		onPasswordReset: ({ user }) => markUsed(user.id)
	},
	/**
	 * Only the server asks for a link and spends it, from Ajustes and /bienvenida: nobody can ask for
	 * one by an email, nor use an older link than the last one given.
	 */
	disabledPaths: [
		'/request-password-reset',
		'/reset-password',
		// The magic links too (#172): only for a device of the house let in from a phone.
		'/sign-in/magic-link',
		'/magic-link/verify'
	],
	account: {
		/**
		 * «Entrar con la nube» (#279): someone of the house is joined by email to their cloud account
		 * the first time. The cloud is the family's own, and gives tokens only to its members, with
		 * the email their invitation's link came to; the house's accounts, made by the administrator,
		 * have no verified email of their own.
		 */
		accountLinking: { trustedProviders: [NUBE_PROVIDER], requireLocalEmailVerified: false }
	},
	databaseHooks: {
		account: {
			create: {
				after: async (account) => {
					if (account.providerId === NUBE_PROVIDER) await dropHousePassword(account.userId);
				}
			}
		}
	},
	hooks: {
		/** Only the first account signs up, the administrator's (#157): it creates the rest. */
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path !== '/sign-up/email') return;
			const [someone] = await db.select({ id: user.id }).from(user).limit(1);
			if (someone)
				throw new APIError('FORBIDDEN', {
					message: 'Ya hay cuentas: pide la tuya a quien administra la app'
				});
		})
	},
	session: {
		/**
		 * 30 days, renewed while used (#172): the living room's TV, entered from a phone, does not
		 * ask again for a month. Children's sessions end with their permission, as before.
		 */
		expiresIn: 30 * 24 * 60 * 60,
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
		// An adult entering on a device of the house, let in from their phone (#172): a link the
		// server makes and spends at once, never sent. Only for accounts that exist.
		magicLink({
			sendMagicLink: ({ email, token }) => keepSignInLink(email, token),
			disableSignUp: true,
			expiresIn: 60,
			storeToken: 'hashed'
		}),
		// The voice satellites (#223): a key each, made by the administrator in Ajustes and kept on the
		// device. Not a session (`enableSessionForAPIKeys`, which the plugin advises against): only
		// checked on the few paths a satellite uses (hooks.server.ts, satellites.ts). An order is two
		// requests: plenty a minute, against a key that leaked being tried over and over.
		apiKey({
			defaultPrefix: 'casita_',
			// Its start in Ajustes, to tell one from another: the prefix and four more.
			startingCharactersConfig: { charactersLength: 11 },
			requireName: true,
			enableMetadata: true,
			rateLimit: { timeWindow: 60_000, maxRequests: 60 }
		}),
		// «Entrar con la nube» (#279), with this house's client in the family's cloud (NUBE_* in the
		// `.env`). Someone new there gets an account here as a normal user; roles stay the house's.
		...(nube
			? [
					genericOAuth({
						config: [
							{
								providerId: NUBE_PROVIDER,
								name: 'Seilide',
								discoveryUrl: `${nube.url}/api/auth/.well-known/openid-configuration`,
								requireIdTokenVerification: true,
								clientId: nube.clientId,
								clientSecret: nube.clientSecret,
								// As the cloud made the client (house-clients.ts): client_secret_basic.
								authentication: 'basic',
								scopes: ['openid', 'profile', 'email']
							}
						]
					})
				]
			: []),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
