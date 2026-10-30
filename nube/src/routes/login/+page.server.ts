import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';
import { deviceOf } from '#lib/server/kid-login.ts';
import { oauthReturn, signedOAuthQuery } from '#lib/server/oauth-return.ts';

/**
 * Once in: back to the house that sent here (#279), at the address the provider checked against
 * its client's, so it may be another site's; or to `?next=`, here.
 */
function goBack(result: unknown, url: URL): never {
	const house = oauthReturn(result);
	if (house) redirect(303, house, { external: true });
	redirect(303, safeNext(url));
}

const safeNext = (url: URL) => {
	const next = url.searchParams.get('next') ?? '/';
	return next.startsWith('/') && !next.startsWith('//') ? next : '/';
};

/** Better Auth's reasons for not taking a code, as they are said here (as jellycartoon's). */
const CODE_PROBLEMS: Record<string, string> = {
	INVALID_CODE: 'Ese código no vale: mira el de ahora en tu app',
	INVALID_BACKUP_CODE: 'Ese código de recuperación no vale, o ya se usó',
	TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Demasiados intentos: vuelve a escribir la contraseña',
	INVALID_TWO_FACTOR_COOKIE: 'Ha pasado demasiado tiempo: vuelve a escribir la contraseña',
	ACCOUNT_TEMPORARILY_LOCKED: 'Demasiados códigos fallidos: espera unos minutos y vuelve a probar'
};
/** After these, the code is no longer asked for: the password again. */
const START_AGAIN = new Set(['TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 'INVALID_TWO_FACTOR_COOKIE']);

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	if (locals.user) redirect(303, safeNext(url));
	// On the family's device (#303), «¿Quién eres?» first; `?adulto`, the password.
	if (!url.searchParams.has('adulto') && !signedOAuthQuery(url) && (await deviceOf(cookies)))
		redirect(303, '/quien');
	/** Come from a house (#279): given back on entering, to go back there (oauth-return.ts). */
	return { oauthQuery: signedOAuthQuery(url) };
};

/**
 * The house's signed query, if the form brought it back: for the provider's hook, which reads it
 * from any sign-in's body (not in Better Auth's types for them).
 */
const oauthQueryOf = (form: FormData): { oauth_query?: string } => {
	const query = String(form.get('oauth_query') ?? '');
	return query ? { oauth_query: query } : {};
};

export const actions: Actions = {
	signIn: async ({ request, url }) => {
		const original = request.clone();
		const form = await request.formData();
		let result;
		try {
			// The request's cookies: a device trusted for the second step is not asked again.
			result = await auth.api.signInEmail({
				body: {
					email: String(form.get('email') ?? ''),
					password: String(form.get('password') ?? ''),
					...oauthQueryOf(form)
				},
				headers: request.headers,
				// The provider resumes a house's authorization from the request itself (oauth-return.ts).
				request: original,
				asResponse: false
			});
		} catch (error) {
			if (error instanceof APIError)
				return fail(400, { message: 'Email o contraseña incorrectos' });
			throw error;
		}
		// Its second step: a code from its app, on this same page.
		if ('twoFactorRedirect' in result && result.twoFactorRedirect) return { twoFactor: true };
		goBack(result, url);
	},
	/** The code from the app, or a recovery code, after the password. */
	verify: async ({ request, url }) => {
		const original = request.clone();
		const form = await request.formData();
		const code = String(form.get('code') ?? '').replace(/\s+/g, '');
		const recovery = form.get('recovery') === 'on';
		const body = { code, trustDevice: form.get('trust') === 'on', ...oauthQueryOf(form) };
		let result;
		try {
			const call = {
				body,
				headers: request.headers,
				request: original,
				asResponse: false as const
			};
			if (recovery) result = await auth.api.verifyBackupCode(call);
			else result = await auth.api.verifyTOTP(call);
		} catch (error) {
			if (!(error instanceof APIError)) throw error;
			const reason = String(error.body?.code ?? '');
			return fail(400, {
				twoFactor: !START_AGAIN.has(reason),
				recovery,
				message: CODE_PROBLEMS[reason] ?? 'No se pudo comprobar el código'
			});
		}
		goBack(result, url);
	}
};
