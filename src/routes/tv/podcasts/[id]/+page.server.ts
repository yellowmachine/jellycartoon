import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { podcastPage } from '#lib/server/podcasts.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const podcast = await podcastPage(locals.user!.id, Number(params.id));
	if (!podcast) error(404, 'Podcast no encontrado');
	return { podcast };
};
