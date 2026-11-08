import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { gameConsoles } from '#lib/server/games.ts';
import { offlineGamesOf, removeOfflineGame } from '#lib/server/games-offline.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { isDeviceId } from 'comun/route-maps.ts';

/** The house's consoles (#405). Its games are played in this browser. And those carried away. */
export const load: PageServerLoad = async ({ locals }) => {
	const offline = await offlineGamesOf(await kitchenOf(locals.user!.id));
	try {
		return { systems: await gameConsoles(locals.user!), problem: null, offline };
	} catch (err) {
		if (!(err instanceof HouseProblem)) throw err;
		if (err.status === null) return { systems: [], problem: err.message, offline };
		error(err.status === 404 ? 404 : 502, err.message);
	}
};

export const actions: Actions = {
	/** A game a device no longer carries; it lets its files go when the app opens there. */
	offlineRemove: async ({ request, locals }) => {
		const form = await request.formData();
		const [system, file, device] = ['system', 'file', 'device'].map((k) => form.get(k));
		if (typeof system !== 'string' || typeof file !== 'string' || !isDeviceId(device))
			return fail(400, { offline: 'Juego no válido' });
		await removeOfflineGame(await kitchenOf(locals.user!.id), system, file, device);
	}
};
