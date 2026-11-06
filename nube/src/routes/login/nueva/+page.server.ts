import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';

/** Opening the email's link changes nothing: whatever reads emails may open it too. */
export const load: PageServerLoad = ({ url }) => ({ token: url.searchParams.get('token') ?? '' });

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		try {
			await auth.api.resetPassword({
				body: {
					newPassword: String(form.get('password') ?? ''),
					token: String(form.get('token') ?? '')
				}
			});
		} catch (error) {
			if (!(error instanceof APIError)) throw error;
			const code = String(error.body?.code ?? '');
			if (code === 'PASSWORD_TOO_SHORT')
				return fail(400, {
					expired: false,
					message: 'La contraseña, de 10 caracteres por lo menos'
				});
			if (code === 'PASSWORD_TOO_LONG')
				return fail(400, { expired: false, message: 'Esa contraseña es demasiado larga' });
			return fail(400, { expired: true, message: 'Este enlace ya no vale: pide otro' });
		}
		// `adulto`: the password's form, also on a device of the family (the second step is still asked).
		redirect(303, '/login?adulto&cambiada');
	}
};
