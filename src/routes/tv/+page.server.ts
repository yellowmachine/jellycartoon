import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { playEpisodes, playlistQueue, seriesQueue } from '#lib/server/cinema/episode-actions.ts';
import { getTodayPlaylist } from '#lib/server/playlist.ts';
import { allSeries, continueWatching } from '#lib/server/watching.ts';

/** The TV view (#11): what is played here goes to the living room's mpv. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado (MPV_SOCKET)');
	const userId = locals.user!.id;
	const [seriesList, watching, today] = await Promise.all([
		allSeries(),
		continueWatching(userId),
		getTodayPlaylist(userId)
	]);
	const pending = today?.items.filter((i) => !i.watched) ?? [];
	return {
		series: seriesList.filter((s) => s.ready > 0),
		continueWatching: watching,
		today: pending[0] ? { next: pending[0], pending: pending.length } : null
	};
};

export const actions: Actions = {
	/** The episode and, with «siguiente automático», the ones after it. */
	episode: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const id = Number((await request.formData()).get('id'));
		return playEpisodes(userId, await seriesQueue(userId, id));
	},
	/** Today's, from the first not watched. */
	today: async ({ locals }) => {
		const userId = locals.user!.id;
		const playlist = await getTodayPlaylist(userId);
		return playEpisodes(userId, playlistQueue(playlist?.items ?? [], null));
	}
};
