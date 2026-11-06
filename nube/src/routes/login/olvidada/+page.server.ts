import { redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/ajustes?seccion=cuenta#contrasena');
};

export const actions: Actions = {
	/** The same answer whether the email has an account or not: nobody learns who is here. */
	default: async ({ request }) => {
		const email = String((await request.formData()).get('email') ?? '').trim();
		try {
			await auth.api.requestPasswordReset({ body: { email } });
		} catch (error) {
			if (!(error instanceof APIError)) throw error;
		}
		return { sent: true };
	}
};
