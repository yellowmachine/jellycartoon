import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { createPlaylist, playlists } from '#lib/server/music.ts';

const whoOf = (locals: App.Locals) => ({ id: locals.user!.id, email: locals.user!.email });

/** The house's playlists (#253); without the house, none. */
export const load: PageServerLoad = async ({ locals }) => ({
	lists: await playlists(whoOf(locals)).catch((error) => {
		if (error instanceof HouseProblem) return [];
		throw error;
	})
});

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Escribe un nombre' });
		let id: number;
		try {
			id = await createPlaylist(whoOf(locals), name.slice(0, 100));
		} catch (error) {
			if (!(error instanceof HouseProblem)) throw error;
			return fail(502, { message: error.message });
		}
		redirect(303, `/musica/listas/${id}`);
	}
};
