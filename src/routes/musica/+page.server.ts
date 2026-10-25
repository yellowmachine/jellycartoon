import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { album, track } from '#lib/server/db/schema.ts';
import { musicRoot } from '#lib/server/library/paths.ts';
import { getAlbums, musicTotals } from '#lib/server/music/albums.ts';
import { wakeMusicCatalog } from '#lib/server/music/catalog.ts';
import { scanMusic } from '#lib/server/music/scan.ts';
import { musicProgress } from '#lib/server/music/status.ts';
import { parseView, viewCookie } from '#lib/views.ts';
import { isKid } from '#lib/server/kids.ts';
import { djEnabled } from '#lib/server/music/dj.ts';
import { deletePreset, presetsOf, savePreset } from '#lib/server/music/dj-presets.ts';
import { parseDjOptions } from '#lib/music.ts';

/** A saved setup's name: short enough for the menu. */
const PRESET_NAME_MAX = 60;

/** Modo DJ: with Piper (PIPER_URL), and not for a child's account (#117). */
function djFor(user: App.Locals['user']) {
	if (!djEnabled || isKid(user)) error(404, 'Sin Modo DJ');
	return user!.id;
}

export const load: PageServerLoad = async ({ cookies, locals }) => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const dj = djEnabled && !isKid(locals.user);
	const [albums, totals, djPresets] = await Promise.all([
		getAlbums(),
		musicTotals(),
		dj ? presetsOf(locals.user!.id) : []
	]);
	return {
		/** Modo DJ: with Piper (PIPER_URL), and not for a child's account (#117). */
		dj,
		/** The person's saved setups, to start again from the menu. */
		djPresets,
		albums,
		totals,
		progress: { ...musicProgress },
		view: parseView('music', cookies.get(viewCookie('music')))
	};
};

export const actions: Actions = {
	/** A Modo DJ setup saved with a name: new, or `id` changed. */
	djSave: async ({ request, locals }) => {
		const userId = djFor(locals.user);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name || name.length > PRESET_NAME_MAX)
			return fail(400, { message: `Ponle un nombre (hasta ${PRESET_NAME_MAX} letras)` });
		let options = null;
		try {
			options = parseDjOptions(JSON.parse(String(form.get('options'))));
		} catch {
			// Stays null.
		}
		if (!options) return fail(400, { message: 'Configuración no válida' });
		const id = Number(form.get('id')) || null;
		const saved = await savePreset(userId, id, name, options);
		if (saved === null) return fail(400, { message: `Ya tienes una que se llama «${name}»` });
		return { saved };
	},
	djDelete: async ({ request, locals }) => {
		const userId = djFor(locals.user);
		const id = Number((await request.formData()).get('id'));
		if (id) await deletePreset(userId, id);
	},
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
	},
	/**
	 * The albums without a cover, looked up again: MusicBrainz may have it now, and the picture
	 * inside their files is tried too (albums marked before it was).
	 */
	covers: async () => {
		await db
			.update(album)
			.set({ coverStatus: 'pending' })
			.where(eq(album.coverStatus, 'not_found'));
		void wakeMusicCatalog();
	}
};
