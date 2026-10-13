import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createPlaylist, listPlaylists } from '#lib/server/music/playlists.ts';

export const load: PageServerLoad = async () => ({ lists: await listPlaylists() });

export const actions: Actions = {
	create: async ({ request }) => {
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Escribe un nombre' });
		redirect(303, `/musica/listas/${await createPlaylist(name.slice(0, 100))}`);
	}
};
