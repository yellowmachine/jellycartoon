import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	deletePlaylist,
	getPlaylist,
	moveInPlaylist,
	removeFromPlaylist,
	renamePlaylist
} from '#lib/server/music/playlists.ts';

export const load: PageServerLoad = async ({ params }) => {
	const playlist = await getPlaylist(Number(params.id));
	if (!playlist) error(404, 'Lista no encontrada');
	return { playlist };
};

async function itemId(request: Request) {
	return Number((await request.formData()).get('itemId'));
}

export const actions: Actions = {
	rename: async ({ params, request }) => {
		const name = String((await request.formData()).get('title') ?? '').trim();
		if (!name) return fail(400, { message: 'El nombre no puede estar vacío' });
		await renamePlaylist(Number(params.id), name.slice(0, 100));
	},
	delete: async ({ params }) => {
		await deletePlaylist(Number(params.id));
		redirect(303, '/musica/listas');
	},
	remove: async ({ params, request }) => {
		await removeFromPlaylist(Number(params.id), await itemId(request));
	},
	up: async ({ params, request }) => {
		await moveInPlaylist(Number(params.id), await itemId(request), -1);
	},
	down: async ({ params, request }) => {
		await moveInPlaylist(Number(params.id), await itemId(request), 1);
	}
};
