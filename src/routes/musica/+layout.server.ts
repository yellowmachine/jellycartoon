import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { musicRoot } from '#lib/server/library/paths.ts';
import { playlistNames } from '#lib/server/music/playlists.ts';

/** Every music page: the playlists, for the «+» of each track. */
export const load: LayoutServerLoad = async () => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	return { playlists: await playlistNames() };
};
