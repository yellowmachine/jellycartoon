import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer } from '#lib/server/media-api.ts';
import { getAlbums } from '#lib/server/music/albums.ts';

/** Enough for a long drive, without sending the whole collection to the phone. */
const TRACKS = 200;

/** The music API (#253): «Todo aleatorio», tracks from all the music in random order, for the cloud's road mode. */
export const GET: RequestHandler = async ({ request }) => {
	await cloudViewer(request);
	const tracks = (await getAlbums()).flatMap((a) => a.tracks);
	for (let i = tracks.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[tracks[i], tracks[j]] = [tracks[j]!, tracks[i]!];
	}
	return json({ tracks: tracks.slice(0, TRACKS) });
};
