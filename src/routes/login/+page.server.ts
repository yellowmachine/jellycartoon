import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';
import { markSetupIfNeeded, SETUP_PATH } from '#lib/server/two-factor.ts';
import { deviceOf } from '#lib/server/kid-login.ts';
import { isAdmin } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';
import { eq } from 'drizzle-orm';

const safeNext = (url: URL) => {
	const next = url.searchParams.get('next') ?? '/';
	return next.startsWith('/') && !next.startsWith('//') ? next : '/';
};

/** Better Auth's reasons for not taking a code, as they are said here. */
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
	// The house's devices first show «¿Quién eres?», with the children and the adults (#141, #172);
	// «Con contraseña» comes here.
	const device = await deviceOf(cookies);
	if (device && !url.searchParams.has('adulto')) redirect(303, '/quien');
	// A new install: its first account, the administrator's, which creates the rest (#157).
	const [someone] = await db.select({ id: user.id }).from(user).limit(1);
	return {
		firstAccount: !someone,
		kids: Boolean(device),
		/** Back from /bienvenida with a second step: the new password and the code, here. */
		passwordChanged: url.searchParams.has('cambiada')
	};
};

export const actions: Actions = {
	signIn: async ({ request, url }) => {
		const form = await request.formData();
		let result;
		try {
			// The request's cookies: a device trusted for the second step is not asked again.
			result = await auth.api.signInEmail({
				body: {
					email: String(form.get('email') ?? ''),
					password: String(form.get('password') ?? '')
				},
				headers: request.headers
			});
		} catch (error) {
			if (error instanceof APIError)
				return fail(400, { message: 'Email o contraseña incorrectos' });
			throw error;
		}
		// Its second step: a code from its app, on this same page.
		if ('twoFactorRedirect' in result && result.twoFactorRedirect) return { twoFactor: true };
		if ('token' in result && result.token && (await markSetupIfNeeded(result.user, result.token)))
			redirect(303, SETUP_PATH);
		redirect(303, safeNext(url));
	},
	/** The code from the app, or a recovery code, after the password. */
	verify: async ({ request, url }) => {
		const form = await request.formData();
		const code = String(form.get('code') ?? '').replace(/\s+/g, '');
		const recovery = form.get('recovery') === 'on';
		const body = { code, trustDevice: form.get('trust') === 'on' };
		try {
			if (recovery) await auth.api.verifyBackupCode({ body, headers: request.headers });
			else await auth.api.verifyTOTP({ body, headers: request.headers });
		} catch (error) {
			if (!(error instanceof APIError)) throw error;
			const reason = String(error.body?.code ?? '');
			return fail(400, {
				twoFactor: !START_AGAIN.has(reason),
				recovery,
				message: CODE_PROBLEMS[reason] ?? 'No se pudo comprobar el código'
			});
		}
		redirect(303, safeNext(url));
	},
	signUp: async ({ request, url }) => {
		const form = await request.formData();
		let result;
		try {
			result = await auth.api.signUpEmail({
				body: {
					email: String(form.get('email') ?? ''),
					password: String(form.get('password') ?? ''),
					name: String(form.get('name') ?? '') || String(form.get('email') ?? '')
				}
			});
		} catch (error) {
			if (error instanceof APIError) return fail(400, { message: error.message });
			throw error;
		}
		// The first account of a new install is the administrator: its second step, first of all.
		// The first account is the administrator: Better Auth's `admin` role too, to set the
		// children's passwords (#141). Installs from before got it in a migration.
		// Its email, as verified: nobody else signs up (#157), and so Better Auth's magic link, for
		// entering on the TV from the phone (#172), keeps its password.
		if (await isAdmin(result.user.id))
			await db
				.update(user)
				.set({ role: 'admin', emailVerified: true })
				.where(eq(user.id, result.user.id));
		if (result.token && (await markSetupIfNeeded(result.user, result.token)))
			redirect(303, SETUP_PATH);
		redirect(303, safeNext(url));
	}
};
