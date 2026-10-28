import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	continueListening,
	searchPodcasts,
	subscribe,
	userPodcasts
} from '#lib/server/podcasts/podcasts.ts';
import type { PodcastResult } from 'comun/podcasts.ts';
import { kitchenOf } from '#lib/server/fridge.ts';

export const load: PageServerLoad = async ({ url, locals }) => {
	const q = url.searchParams.get('q')?.trim() ?? '';
	let results: PodcastResult[] | null = null;
	let searchError: string | null = null;
	if (q)
		try {
			results = await searchPodcasts(q);
		} catch (err) {
			searchError = `No se pudo buscar en el directorio de Apple: ${err instanceof Error ? err.message : err}`;
		}
	const k = await kitchenOf(locals.user!.id);
	const [podcasts, inProgress] = await Promise.all([userPodcasts(k), continueListening(k)]);
	return { q, results, searchError, podcasts, inProgress };
};

export const actions: Actions = {
	/** From the search, or a feed's address pasted by hand. */
	subscribe: async ({ request, locals }) => {
		const form = await request.formData();
		const feedUrl = String(form.get('feedUrl') ?? '').trim();
		// Pasted by hand: kept in its box, to correct it.
		const typed = form.has('typed') ? feedUrl : '';
		if (!feedUrl) return fail(400, { feedUrl: typed, error: 'Falta la dirección del feed' });
		let id;
		try {
			id = await subscribe(await kitchenOf(locals.user!.id), feedUrl);
		} catch (err) {
			return fail(400, { feedUrl: typed, error: err instanceof Error ? err.message : String(err) });
		}
		redirect(303, `/radio/podcasts/${id}`);
	}
};
