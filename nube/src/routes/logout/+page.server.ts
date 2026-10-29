import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { auth } from '#lib/server/auth.ts';

export const actions: Actions = {
	/** Out; back to `?next=` (an invitation's page, to enter with its account), or to /login. */
	default: async ({ request, url }) => {
		await auth.api.signOut({ headers: request.headers });
		const next = url.searchParams.get('next');
		redirect(303, next?.startsWith('/') && !next.startsWith('//') ? next : '/login');
	}
};
