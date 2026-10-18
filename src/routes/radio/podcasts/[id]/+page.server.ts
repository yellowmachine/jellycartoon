import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	markListened,
	podcastPage,
	refreshPodcast,
	subscribe,
	unsubscribe
} from '#lib/server/podcasts/podcasts.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const podcast = await podcastPage(locals.user!.id, Number(params.id));
	if (!podcast) error(404, 'Podcast no encontrado');
	return { podcast };
};

export const actions: Actions = {
	subscribe: async ({ params, locals }) => {
		const podcast = await podcastPage(locals.user!.id, Number(params.id));
		if (!podcast) error(404, 'Podcast no encontrado');
		await subscribe(locals.user!.id, podcast.feedUrl);
	},
	/** Back to the list: a podcast no one follows goes, and its page with it. */
	unsubscribe: async ({ params, locals }) => {
		await unsubscribe(locals.user!.id, Number(params.id));
		redirect(303, '/radio/podcasts');
	},
	/** Its feed read now, without waiting for the next round. */
	refresh: async ({ params }) => {
		const problem = await refreshPodcast(Number(params.id));
		if (problem) return fail(502, { error: problem });
	},
	listened: async ({ request, locals }) => {
		const form = await request.formData();
		const episodeId = Number(form.get('episodeId'));
		if (!Number.isInteger(episodeId)) return fail(400, { error: 'Falta el episodio' });
		await markListened(locals.user!.id, episodeId, form.get('value') === 'true');
	}
};
