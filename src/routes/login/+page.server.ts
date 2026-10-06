import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { ALLOW_SIGNUP } from '$app/env/private';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';

const safeNext = (url: URL) => {
	const next = url.searchParams.get('next') ?? '/';
	return next.startsWith('/') && !next.startsWith('//') ? next : '/';
};

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url));
	return { allowSignup: ALLOW_SIGNUP };
};

export const actions: Actions = {
	signIn: async ({ request, url }) => {
		const form = await request.formData();
		try {
			await auth.api.signInEmail({
				body: {
					email: String(form.get('email') ?? ''),
					password: String(form.get('password') ?? '')
				}
			});
		} catch (error) {
			if (error instanceof APIError)
				return fail(400, { message: 'Email o contraseña incorrectos' });
			throw error;
		}
		redirect(303, safeNext(url));
	},
	signUp: async ({ request, url }) => {
		const form = await request.formData();
		try {
			await auth.api.signUpEmail({
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
		redirect(303, safeNext(url));
	}
};
