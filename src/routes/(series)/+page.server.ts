import type { Actions, PageServerLoad } from './$types';
import { getTodayPlaylist } from '#lib/server/playlist.ts';
import { dismissProgress } from '#lib/server/progress.ts';
import { allSeries, continueWatching } from '#lib/server/watching.ts';
import { homeworkToDo } from '#lib/server/homework.ts';
import { isKid } from '#lib/server/kids.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	const [seriesList, watching, today, homework] = await Promise.all([
		allSeries(),
		continueWatching(userId),
		getTodayPlaylist(userId),
		// A child's homework to do (#142), first on their page.
		isKid(locals.user) ? homeworkToDo(userId) : []
	]);

	const pending = today?.items.filter((i) => !i.watched) ?? [];
	return {
		series: seriesList,
		homework,
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
