import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlaylist } from '#lib/server/music/playlists.ts';

/** A music list's tracks, to play it from the road mode (#78) without loading them all first. */
export const GET: RequestHandler = async ({ params }) => {
	const playlist = await getPlaylist(Number(params.id));
	if (!playlist) error(404, 'Lista no encontrada');
	return json(playlist.items.map((i) => i.track));
};
