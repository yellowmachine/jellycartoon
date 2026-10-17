import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { musicRoot } from '#lib/server/library/paths.ts';
import { getAlbums } from '#lib/server/music/albums.ts';
import { listPlaylists } from '#lib/server/music/playlists.ts';

export const load: PageServerLoad = async () => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const [albums, playlists] = await Promise.all([getAlbums(), listPlaylists()]);
	return {
		// Only what the tiles show: the tracks are loaded with the album.
		albums: albums.map(({ id, title, artist, hasCover }) => ({ id, title, artist, hasCover })),
		playlists: playlists.filter((p) => p.total > 0)
	};
};
