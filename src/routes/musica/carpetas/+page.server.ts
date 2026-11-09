import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { musicFolder } from '#lib/server/music/albums.ts';

/** Música → Carpetas: a folder of the music as it is on disk (`?ruta=`), with what has no album. */
export const load: PageServerLoad = async ({ url }) => {
	const folder = await musicFolder(url.searchParams.get('ruta') ?? '');
	if (!folder) error(404, 'En esa carpeta no hay audios');
	return { folder };
};
