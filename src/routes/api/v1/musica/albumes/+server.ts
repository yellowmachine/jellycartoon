import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { getAlbums } from '#lib/server/music/albums.ts';

/**
 * The music API (#253): the house's albums, by artist and title, without their tracks (asked for
 * one by one, `albumes/<id>`): what the road mode shows to choose from.
 */
export const GET: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	const albums = await getAlbums();
	return json({
		albums: albums.map((a) => ({
			id: a.id,
			title: a.title,
			artist: a.artist,
			hasCover: a.hasCover,
			tracks: a.tracks.length,
			durationSec: Math.round(a.tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0))
		}))
	});
};
