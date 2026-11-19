import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { createPlaylist, playlists } from '#lib/server/music.ts';
import { offlineListsOf, orderOffline, removeOffline } from '#lib/server/music-offline.ts';
import { isDeviceId } from 'comun/route-maps.ts';
import { withFamily } from '#lib/server/family.ts';
import { sourceView } from '#lib/server/own-music.ts';
import { createOwnPlaylist, NAME_MAX, ownPlaylists } from '#lib/server/own-music-lists.ts';

const whoOf = (locals: App.Locals) => ({ id: locals.user!.id, email: locals.user!.email });

/**
 * The playlists of this person's music source (#534, phase 3): the house's (#253; without the
 * house, none), with which devices carry them (#350); or the family's own bucket's, kept in Seilide
 * (#534, phase 2).
 */
export const load: PageServerLoad = async ({ locals, parent }) => {
	if ((await parent()).source === 'propia') {
		const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
		const own = (await sourceView(familyId)) ? await ownPlaylists(familyId) : [];
		return { own, lists: [], offline: null };
	}
	const [lists, offline] = await Promise.all([
		playlists(whoOf(locals)).catch((error) => {
			if (error instanceof HouseProblem) return [];
			throw error;
		}),
		kitchenOf(locals.user!.id).then(offlineListsOf)
	]);
	return { own: null, lists, offline };
};

/** The list and the device of an order to carry it without coverage, if well formed. */
async function offlineOrder(request: Request) {
	const form = await request.formData();
	const playlistId = Number(form.get('list'));
	const device = form.get('device');
	return Number.isInteger(playlistId) && isDeviceId(device) ? { playlistId, device } : null;
}

export const actions: Actions = {
	/** A list of «Tu música» (#534, phase 2), kept here. */
	ownCreate: async ({ request, locals }) => {
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { ownMessage: 'Escribe un nombre' });
		const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
		redirect(
			303,
			`/musica/tu-musica/listas/${await createOwnPlaylist(familyId, name.slice(0, NAME_MAX))}`
		);
	},
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
	},
	/** A list to carry on a device (#350); done by it when the app opens on it. */
	offlineAdd: async ({ request, locals }) => {
		const order = await offlineOrder(request);
		if (!order) return fail(400, { offline: 'Elige el dispositivo' });
		let why: string | null;
		try {
			why = await orderOffline(
				await kitchenOf(locals.user!.id),
				whoOf(locals),
				order.playlistId,
				order.device
			);
		} catch (error) {
			if (!(error instanceof HouseProblem)) throw error;
			return fail(502, { offline: error.message });
		}
		if (why) return fail(400, { offline: why });
	},
	offlineRemove: async ({ request, locals }) => {
		const order = await offlineOrder(request);
		if (!order) return fail(400, { offline: 'Lista no válida' });
		await removeOffline(await kitchenOf(locals.user!.id), order.playlistId, order.device);
	}
};
