import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { musicRoot } from '#lib/server/library/paths.ts';
import { getPlaylist } from '#lib/server/music/playlists.ts';

export const load: PageServerLoad = async ({ params }) => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const playlist = await getPlaylist(Number(params.id));
	if (!playlist) error(404, 'Lista no encontrada');
	return { name: playlist.name, tracks: playlist.items.map((i) => i.track) };
};
