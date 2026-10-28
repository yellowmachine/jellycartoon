import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { allSeries } from '#lib/server/watching.ts';

/** The video API (#253): the series with something to watch. */
export const GET: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	const series = (await allSeries()).filter((s) => s.ready > 0);
	return json({ series: series.map((s) => ({ id: s.id, title: s.title, episodes: s.ready })) });
};
