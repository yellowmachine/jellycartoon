import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { gameDetails, gameSummary } from '#lib/server/games.ts';
import { offlineGamesOf, orderOfflineGame } from '#lib/server/games-offline.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { isDeviceId } from 'comun/route-maps.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const who = locals.user!;
	try {
		const [game, offline] = await Promise.all([
			gameSummary(who, params.system, params.file),
			kitchenOf(who.id).then(offlineGamesOf)
		]);
		// Looked up the first time, while the page is already shown.
		const details = gameDetails(who, params.system, params.file).catch(() => null);
		return {
			game,
			offline,
			backdrop: details.then((d) => d?.backdrop ?? null),
			info: details.then((d) => d?.info ?? null)
		};
	} catch (err) {
		if (err instanceof HouseProblem) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}
};

export const actions: Actions = {
	/** The game to carry on a device, to play it without coverage; done by it when the app opens. */
	offlineAdd: async ({ params, request, locals }) => {
		const device = (await request.formData()).get('device');
		if (!isDeviceId(device)) return fail(400, { offline: 'Elige el dispositivo' });
		const who = { id: locals.user!.id, email: locals.user!.email };
		let why: string | null;
		try {
			why = await orderOfflineGame(
				await kitchenOf(who.id),
				who,
				params.system,
				params.file,
				device
			);
		} catch (err) {
			if (!(err instanceof HouseProblem)) throw err;
			return fail(502, { offline: err.message });
		}
		if (why) return fail(400, { offline: why });
	}
};
