import type { Actions, PageServerLoad } from './$types';
import { getTodayPlaylist } from '#lib/server/playlist.ts';
import { dismissProgress } from '#lib/server/progress.ts';
import { allSeries, continueWatching } from '#lib/server/watching.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	const [seriesList, watching, today] = await Promise.all([
		allSeries(),
		continueWatching(userId),
		getTodayPlaylist(userId)
	]);

	const pending = today?.items.filter((i) => !i.watched) ?? [];
	return {
		series: seriesList,
		continueWatching: watching,
		today: today && {
			total: today.items.length,
			pending: pending.length,
			pendingSec: pending.reduce((sum, i) => sum + (i.durationSec ?? 0), 0),
			next: pending[0] ?? null
		}
	};
};

export const actions: Actions = {
	/** Out of «Seguir viendo»; where it was left is kept. */
	dismiss: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id)) await dismissProgress(locals.user!.id, id);
	}
};
