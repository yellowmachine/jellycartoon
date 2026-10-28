import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { auth } from '#lib/server/auth.ts';

export const actions: Actions = {
	default: async ({ request }) => {
		await auth.api.signOut({ headers: request.headers });
		redirect(303, '/login');
	}
};
