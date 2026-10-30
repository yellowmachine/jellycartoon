import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer } from '#lib/server/media-api.ts';
import { getAlbums } from '#lib/server/music/albums.ts';

/** The music API (#253): an album and its tracks, in order. */
export const GET: RequestHandler = async ({ request, params }) => {
	await cloudViewer(request);
	const [album] = await getAlbums(Number(params.id));
	if (!album) error(404, 'Álbum no encontrado');
	return json({ album });
};
