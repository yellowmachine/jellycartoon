import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lyricsOf } from '#lib/server/music/lyrics.ts';

/** A song's lyrics (lyrics.ts), with the time of each line if it has them; null, none. */
export const GET: RequestHandler = async ({ params }) =>
	json(await lyricsOf(Number(params.id)), {
		headers: { 'Cache-Control': 'private, max-age=3600' }
	});
