import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAlbums } from '#lib/server/music/albums.ts';
import { musicRoot } from '#lib/server/library/paths.ts';

/** An album's tracks, in order, to play it from the road mode's Música (#78). */
export const GET: RequestHandler = async ({ params }) => {
	if (!musicRoot) error(404, 'No hay música');
	const [found] = await getAlbums(Number(params.id));
	if (!found) error(404, 'Álbum no encontrado');
	return json(found.tracks);
};
