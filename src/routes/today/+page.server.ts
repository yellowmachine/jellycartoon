import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { generatePlaylist, getTodayPlaylist } from '#lib/server/playlist.ts';
import { getSettings } from '#lib/server/settings.ts';
import { playEpisodes, playlistQueue } from '#lib/server/cinema/episode-actions.ts';

const DURATIONS = [30, 60, 90];

export const load: PageServerLoad = async ({ locals }) => {
	const [playlist, settings] = await Promise.all([
		getTodayPlaylist(locals.user!.id),
		getSettings(locals.user!.id)
	]);
	return { playlist, settings, durations: DURATIONS };
};

export const actions: Actions = {
	/** In the living room, from `episodeId` (or the first not watched) on. */
	salon: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const playlist = await getTodayPlaylist(userId);
		const from = (await request.formData()).get('episodeId');
		return playEpisodes(userId, playlistQueue(playlist?.items ?? [], from ? Number(from) : null));
	},
	generate: async ({ request, locals }) => {
		const minutes = Number((await request.formData()).get('minutes'));
		if (!DURATIONS.includes(minutes)) return fail(400, { message: 'Duración no válida' });
		await generatePlaylist(locals.user!.id, minutes);
	}
};
