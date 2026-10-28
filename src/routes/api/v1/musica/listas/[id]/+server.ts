import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { getPlaylist } from '#lib/server/music/playlists.ts';

/** The music API (#253): a playlist and its tracks, in order. */
export const GET: RequestHandler = async ({ request, params }) => {
	await cloudPerson(request);
	const playlist = await getPlaylist(Number(params.id));
	if (!playlist) error(404, 'Lista no encontrada');
	return json({
		playlist: { id: playlist.id, name: playlist.name, tracks: playlist.items.map((i) => i.track) }
	});
};
