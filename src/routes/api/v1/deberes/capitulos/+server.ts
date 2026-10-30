import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchEpisodes } from '#lib/server/homework-source.ts';
import { cloudPerson } from '#lib/server/media-api.ts';

/**
 * Homework (#142): any episode with dialogue of the children's series, by series or title
 * (`?q=dexter`), for when a child watched it elsewhere or will watch it later.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	await cloudPerson(request);
	return json({ capitulos: await searchEpisodes(url.searchParams.get('q') ?? '') });
};
