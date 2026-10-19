import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { track } from '#lib/server/db/schema.ts';
import { musicRoot } from '#lib/server/library/paths.ts';
import { getAlbums, musicTotals } from '#lib/server/music/albums.ts';
import { wakeMusicCatalog } from '#lib/server/music/catalog.ts';
import { scanMusic } from '#lib/server/music/scan.ts';
import { musicProgress } from '#lib/server/music/status.ts';
import { parseView, viewCookie } from '#lib/views.ts';

export const load: PageServerLoad = async ({ cookies }) => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const [albums, totals] = await Promise.all([getAlbums(), musicTotals()]);
	return {
		albums,
		totals,
		progress: { ...musicProgress },
		view: parseView('music', cookies.get(viewCookie('music')))
	};
};

export const actions: Actions = {
	/** Not waited for: the page follows it, also on other devices. */
	scan: async () => {
		scanMusic().catch(() => {});
		return { started: true };
	},
	retry: async () => {
		await db
			.update(track)
			.set({ status: 'pending', error: null })
			.where(and(eq(track.status, 'error'), eq(track.missing, false)));
		await db
			.update(track)
			.set({ opus: 'pending', opusError: null })
			.where(and(eq(track.opus, 'error'), eq(track.missing, false)));
		// The Opus copies, after it.
		void wakeMusicCatalog();
	}
};
