import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { moveOf } from 'comun/reorder.ts';
import { isKid } from '#lib/server/kids.ts';
import { djEnabled } from '#lib/server/music/dj.ts';
import {
	deletePlaylist,
	getPlaylist,
	moveInPlaylist,
	moveInPlaylistBefore,
	removeFromPlaylist,
	renamePlaylist
} from '#lib/server/music/playlists.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const playlist = await getPlaylist(Number(params.id));
	if (!playlist) error(404, 'Lista no encontrada');
	/** «Con DJ»: Modo DJ with its songs, if there is one (not for a child's account, #117). */
	return { playlist, dj: !isKid(locals.user) && (await djEnabled()) };
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
	},
	/** Dragged into place (comun/reorder.svelte.ts). */
	move: async ({ params, request }) => {
		const move = moveOf(await request.formData());
		if (!move) return fail(400, { message: 'Canción no válida' });
		await moveInPlaylistBefore(Number(params.id), move.itemId, move.beforeId);
	}
};
