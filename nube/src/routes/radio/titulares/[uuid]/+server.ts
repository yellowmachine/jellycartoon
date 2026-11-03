import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stationHeadlines } from '#lib/server/radio-news.ts';

/** The headlines of a station (#387), for Radio while it plays: none for one without a feed. */
export const GET: RequestHandler = async ({ params }) => {
	const headlines = await stationHeadlines(params.uuid);
	if (!headlines) error(404, 'Esta emisora no tiene titulares');
	return json(headlines, { headers: { 'cache-control': 'private, max-age=300' } });
};
