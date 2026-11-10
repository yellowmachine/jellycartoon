import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { familyLinks } from '#lib/server/family-links.ts';

/**
 * A link to link two families (#464), opened by someone of the other one: what it invites to, or
 * why they cannot accept it. Without a session, the login brings them back here (hooks.server.ts).
 */
export const load: PageServerLoad = async ({ params, locals }) => ({
	link: await familyLinks.byToken(params.token, locals.user!.id)
});

export const actions: Actions = {
	accept: async ({ params, locals }) => {
		const done = await familyLinks.accept(params.token, locals.user!.id);
		if (!done.ok) return fail(400, { problem: done.problem });
		redirect(303, `/llamadas?vinculada=${encodeURIComponent(done.familyName)}`);
	}
};
