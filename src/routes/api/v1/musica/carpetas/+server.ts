import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer } from '#lib/server/media-api.ts';
import { musicFolder } from '#lib/server/music/albums.ts';

/** The music API (#253): a folder of the music as it is on disk (`?ruta=`), for Música → Carpetas. */
export const GET: RequestHandler = async ({ request, url }) => {
	await cloudViewer(request);
	const folder = await musicFolder(url.searchParams.get('ruta') ?? '');
	if (!folder) error(404, 'Carpeta sin audios');
	return json({ folder });
};
