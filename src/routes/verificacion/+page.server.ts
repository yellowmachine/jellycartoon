import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { renderSVG } from 'uqr';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';
import { canUseTwoFactor, mustHaveTwoFactor, mustSetUp } from '#lib/server/two-factor.ts';

/**
 * Setting up the second step (#82, #45): the password again, a QR for the app (Proton Pass, Google
 * Authenticator…), a code from it to see that it works, and the recovery codes. The administrator
 * comes here on their first sign-in without it; anyone else, from Ajustes.
 */

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	if (!canUseTwoFactor(user)) redirect(303, '/');
	return {
		enabled: Boolean(user.twoFactorEnabled),
		/** Nothing else until it is done: no «Ahora no». */
		required: mustSetUp(locals.session!, user),
		admin: await mustHaveTwoFactor(user.id)
	};
};

export const actions: Actions = {
	/** The password: its secret for the app, and the recovery codes, not in use until confirmed. */
	start: async ({ request, locals }) => {
		if (!canUseTwoFactor(locals.user!)) return fail(403, { message: 'No disponible' });
		const password = String((await request.formData()).get('password') ?? '');
		let result;
		try {
			result = await auth.api.enableTwoFactor({ body: { password }, headers: request.headers });
		} catch (error) {
			if (!(error instanceof APIError)) throw error;
			return fail(400, {
				message:
					error.body?.code === 'TOTP_ALREADY_ENABLED'
						? 'Ya la tienes activada'
						: 'Contraseña incorrecta'
			});
		}
		if (!('totpURI' in result) || !result.totpURI) return fail(500, { message: 'No se pudo' });
		const secret = new URL(result.totpURI).searchParams.get('secret') ?? '';
		return {
			uri: result.totpURI,
			// In groups of four, to copy it by hand into the app if the QR cannot be read.
			secret: secret.match(/.{1,4}/g)?.join(' ') ?? secret,
			qr: `data:image/svg+xml;base64,${Buffer.from(renderSVG(result.totpURI)).toString('base64')}`,
			codes: result.backupCodes ?? []
		};
	},
	/** A code from the app: from now on, it is asked for after the password. */
	confirm: async ({ request }) => {
		const code = String((await request.formData()).get('code') ?? '').replace(/\s+/g, '');
		try {
			await auth.api.verifyTOTP({ body: { code }, headers: request.headers });
		} catch (error) {
			if (!(error instanceof APIError)) throw error;
			return fail(400, {
				confirmProblem:
					'Ese código no vale: mira que la hora del móvil esté bien, y prueba el de ahora'
			});
		}
		return { confirmed: true };
	}
};
