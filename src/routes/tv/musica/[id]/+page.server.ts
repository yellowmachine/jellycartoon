import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { musicRoot } from '#lib/server/library/paths.ts';
import { getAlbums } from '#lib/server/music/albums.ts';

export const load: PageServerLoad = async ({ params }) => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const [album] = await getAlbums(Number(params.id));
	if (!album) error(404, 'Álbum no encontrado');
	return { album };
};
