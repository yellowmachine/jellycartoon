import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { moveOf } from 'comun/reorder.ts';
import { withFamily } from '#lib/server/family.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { ownDjEnabled } from '#lib/server/own-music-dj.ts';
import {
	deleteOwnPlaylist,
	moveInOwnPlaylist,
	moveInOwnPlaylistBefore,
	NAME_MAX,
	ownPlaylistOf,
	removeFromOwnPlaylist,
	renameOwnPlaylist
} from '#lib/server/own-music-lists.ts';

/** A list of «Tu música» (#534, phase 2), as the house's: to play, reorder, rename or delete. */
const familyOf = (locals: App.Locals) => withFamily(locals.user!.id, async (_, m) => m.familyId);

export const load: PageServerLoad = async ({ params, locals }) => {
	const list = await ownPlaylistOf(await familyOf(locals), Number(params.id));
	if (!list) error(404, 'Esa lista no está');
	/** «Con DJ»: Seilide is its DJ, with the family's OpenRouter key. */
	return { list, dj: await ownDjEnabled(await kitchenOf(locals.user!.id)) };
};

const itemOf = async (request: Request) => Number((await request.formData()).get('itemId'));

export const actions: Actions = {
	rename: async ({ params, request, locals }) => {
		const name = String((await request.formData()).get('title') ?? '').trim();
		if (!name) return fail(400, { message: 'El nombre no puede estar vacío' });
		await renameOwnPlaylist(await familyOf(locals), Number(params.id), name.slice(0, NAME_MAX));
	},
	delete: async ({ params, locals }) => {
		await deleteOwnPlaylist(await familyOf(locals), Number(params.id));
		redirect(303, '/musica/listas');
	},
	remove: async ({ params, request, locals }) => {
		await removeFromOwnPlaylist(await familyOf(locals), Number(params.id), await itemOf(request));
	},
	up: async ({ params, request, locals }) => {
		await moveInOwnPlaylist(await familyOf(locals), Number(params.id), await itemOf(request), 'up');
	},
	down: async ({ params, request, locals }) => {
		await moveInOwnPlaylist(
			await familyOf(locals),
			Number(params.id),
			await itemOf(request),
			'down'
		);
	},
	/** Dragged into place (comun/reorder.svelte.ts). */
	move: async ({ params, request, locals }) => {
		const move = moveOf(await request.formData());
		if (!move) return fail(400, { message: 'Canción no válida' });
		await moveInOwnPlaylistBefore(
			await familyOf(locals),
			Number(params.id),
			move.itemId,
			move.beforeId
		);
	}
};
