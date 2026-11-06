import { ORIGIN, BETTER_AUTH_SECRET } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { jwt } from 'better-auth/plugins/jwt';
import { oauthProvider } from '@better-auth/oauth-provider';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '#lib/server/db/index.ts';
import { DISABLED_PATHS } from '#lib/server/auth-paths.ts';
import { afterDeleteAccount, beforeDeleteAccount } from '#lib/server/account-deletion.ts';
import {
	sendDeleteAccountMail,
	sendPasswordChanged,
	sendPasswordResetMail
} from '#lib/server/emails.ts';
import { mayMailReset } from '#lib/server/password-reset.ts';
import { invitations } from '#lib/server/invitations.ts';
import {
	clientPrivileges,
	clientReference,
	idTokenClaims,
	userInfoClaims
} from '#lib/server/oidc.ts';
import { FAMILY_SCOPE } from '#lib/server/oidc-claims.ts';

export const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 10,
		revokeSessionsOnPasswordReset: true,
		// Not awaited, as Better Auth's docs ask: the answer takes as long with an account as without.
		sendResetPassword: async ({ user, token }) => {
			if (!mayMailReset(user.email)) return;
			void sendPasswordResetMail(user.email, `${ORIGIN}/login/nueva?token=${token}`).catch((e) =>
				console.error('[cuentas] No se pudo mandar el enlace de la contraseña', e)
			);
		},
		onPasswordReset: async ({ user }) => {
			void sendPasswordChanged(user.email).catch((e) =>
				console.error('[cuentas] No se pudo avisar del cambio de contraseña', e)
			);
		}
	},
	disabledPaths: DISABLED_PATHS,
	user: {
		// «Eliminar mi cuenta» (#315): by a link in an email, kept a day, to its page (auth-paths.ts).
		deleteUser: {
			enabled: true,
			sendDeleteAccountVerification: ({ user, token }) =>
				sendDeleteAccountMail(user.email, `${ORIGIN}/cuenta/eliminar?token=${token}`),
			beforeDelete: (user) => beforeDeleteAccount(user),
			afterDelete: (user) => afterDeleteAccount(user)
		}
	},
	hooks: {
		/**
		 * Only who was invited signs up: the app is on the internet. From the invitation's page
		 * (/invitacion/<token>), which then accepts it (invitation-scope.ts); over HTTP, closed
		 * (auth-paths.ts). This, again, for whatever else calls it.
		 */
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path !== '/sign-up/email') return;
			const email = String(ctx.body?.email ?? '');
			if (!(await invitations.pendingFor(email)))
				throw new APIError('FORBIDDEN', {
					message: 'Ese email no tiene invitación: pídesela a quien administra tu familia'
				});
		})
	},
	/** 30 days, renewed while used, as jellycartoon's. */
	session: { expiresIn: 30 * 24 * 60 * 60 },
	plugins: [
		// A code from an app (Proton Pass, Aegis…) after the password, for whoever turns it on in
		// Ajustes; 10 recovery codes for a lost phone. A trusted device is not asked for 90 days.
		twoFactor({ issuer: 'Seilide', trustDeviceMaxAge: 90 * 24 * 60 * 60 }),
		// One account for the cloud and the house (#279): the cloud is the houses' OpenID provider,
		// and each house a client of its family's (oidc.ts), trusted, so no consent is asked. The
		// house's «Entrar con la nube» comes here to /login, and back once in, second step and all.
		// And of the apps (#284: Langua, Librarian), made by the service's administrator.
		jwt(),
		oauthProvider({
			loginPage: '/login',
			// Never shown: the houses' and the apps' clients skip it (oidc.ts).
			consentPage: '/login',
			// `family`: the person's family in the token, for the apps of families (oidc-claims.ts).
			// `offline_access`: a refresh token, for the apps that call /api/ia (app-clients.ts).
			scopes: ['openid', 'profile', 'email', 'offline_access', FAMILY_SCOPE],
			grantTypes: ['authorization_code', 'refresh_token'],
			clientReference,
			clientPrivileges,
			customIdTokenClaims: idTokenClaims,
			customUserInfoClaims: userInfoClaims
		}),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
