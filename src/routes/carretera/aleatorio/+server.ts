import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAlbums } from '#lib/server/music/albums.ts';
import { musicRoot } from '#lib/server/library/paths.ts';

/** Enough for a long drive, without sending the whole collection to the phone. */
const TRACKS = 200;

/** «Todo aleatorio» in the road mode (#78): tracks from all the music, in random order. */
export const GET: RequestHandler = async () => {
	if (!musicRoot) error(404, 'No hay música');
	const tracks = (await getAlbums()).flatMap((a) => a.tracks);
	for (let i = tracks.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[tracks[i], tracks[j]] = [tracks[j]!, tracks[i]!];
	}
	return json(tracks.slice(0, TRACKS));
};
