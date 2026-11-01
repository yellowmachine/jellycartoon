import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { createPlaylist, playlists } from '#lib/server/music.ts';
import { offlineListsOf, orderOffline, removeOffline } from '#lib/server/music-offline.ts';
import { isDeviceId } from 'comun/route-maps.ts';

const whoOf = (locals: App.Locals) => ({ id: locals.user!.id, email: locals.user!.email });

/** The house's playlists (#253); without the house, none. And which devices carry them (#350). */
export const load: PageServerLoad = async ({ locals }) => {
	const [lists, offline] = await Promise.all([
		playlists(whoOf(locals)).catch((error) => {
			if (error instanceof HouseProblem) return [];
			throw error;
		}),
		kitchenOf(locals.user!.id).then(offlineListsOf)
	]);
	return { lists, offline };
};

/** The list and the device of an order to carry it without coverage, if well formed. */
async function offlineOrder(request: Request) {
	const form = await request.formData();
	const playlistId = Number(form.get('list'));
	const device = form.get('device');
	return Number.isInteger(playlistId) && isDeviceId(device) ? { playlistId, device } : null;
}

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
