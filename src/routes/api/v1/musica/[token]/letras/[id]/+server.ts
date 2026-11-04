import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CORS, musicPassOf, withCors } from '#lib/server/media-api.ts';
import { lyricsOf } from '#lib/server/music/lyrics.ts';

/** The music API (#253): a song's lyrics, by the pass; null, none. */
export const GET: RequestHandler = async ({ params }) => {
	musicPassOf(params.token);
	return withCors(
		json(await lyricsOf(Number(params.id)), {
			headers: { 'Cache-Control': 'private, max-age=3600' }
		})
	);
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
