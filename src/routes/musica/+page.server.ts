import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { musicRoot } from '#lib/server/library/paths.ts';
import { getAlbums, pendingTracks } from '#lib/server/music/albums.ts';
import { scanMusic } from '#lib/server/music/scan.ts';

export const load: PageServerLoad = async () => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const [albums, pending] = await Promise.all([getAlbums(), pendingTracks()]);
	return { albums, pending };
};

export const actions: Actions = {
	scan: async () => {
		try {
			return { scan: await scanMusic() };
		} catch (err) {
			return fail(500, { message: err instanceof Error ? err.message : String(err) });
		}
	}
};
