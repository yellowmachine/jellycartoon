import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { gameConsoles } from '#lib/server/games.ts';
import { offlineGamesOf, removeOfflineGame } from '#lib/server/games-offline.ts';
import { gameSources } from '#lib/server/game-source.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { ownConsoles, sourceView } from '#lib/server/own-games.ts';
import { isDeviceId } from 'comun/route-maps.ts';
import { isOfflineGameSource } from '#lib/offline-games.ts';

/**
 * The consoles (#405): the house's, or the family's bucket's (#564), as the person chose in
 * Ajustes. Their games are played in this browser. And those carried away (the house's).
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const offline = await offlineGamesOf(k);
	if ((await gameSources(locals.user!.id)).current === 'propia') {
		const source = await sourceView(k.familyId);
		return {
			own: { scanning: Boolean(source?.scanning), problem: source?.problem ?? null },
			systems: await ownConsoles(k.familyId),
			problem: null,
			offline
		};
	}
	try {
		return { own: null, systems: await gameConsoles(locals.user!), problem: null, offline };
	} catch (err) {
		if (!(err instanceof HouseProblem)) throw err;
		if (err.status === null) return { own: null, systems: [], problem: err.message, offline };
		error(err.status === 404 ? 404 : 502, err.message);
	}
};

export const actions: Actions = {
	/** A game a device no longer carries; it lets its files go when the app opens there. */
	offlineRemove: async ({ request, locals }) => {
		const form = await request.formData();
		const [system, file, device, source] = ['system', 'file', 'device', 'source'].map((k) =>
			form.get(k)
		);
		if (
			typeof system !== 'string' ||
			typeof file !== 'string' ||
			!isDeviceId(device) ||
			!isOfflineGameSource(source)
		)
			return fail(400, { offline: 'Juego no válido' });
		await removeOfflineGame(await kitchenOf(locals.user!.id), { system, file, source }, device);
	}
};
