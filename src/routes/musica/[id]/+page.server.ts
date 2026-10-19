import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { musicRoot } from '#lib/server/library/paths.ts';
import { getAlbums, renameAlbum, renameTrack, tagTitles } from '#lib/server/music/albums.ts';
import { chooseCover, proposeCovers } from '#lib/server/music/cover-proposals.ts';
import { log } from '#lib/server/log.ts';

export const load: PageServerLoad = async ({ params }) => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const id = Number(params.id);
	const [[album], tags] = await Promise.all([getAlbums(id), tagTitles(id)]);
	if (!album) error(404, 'Álbum no encontrado');
	return { album, tagTitles: tags };
};

export const actions: Actions = {
	/** An empty title goes back to the one from the tags. */
	renameAlbum: async ({ params, request }) => {
		const title = String((await request.formData()).get('title') ?? '').trim();
		await renameAlbum(Number(params.id), 'title', title);
	},
	/** The album's artist, also its tracks' that had the same one. */
	renameArtist: async ({ params, request }) => {
		const artist = String((await request.formData()).get('title') ?? '').trim();
		await renameAlbum(Number(params.id), 'artist', artist);
	},
	/** Covers to choose from, for one the automatic search did not find. */
	proposeCovers: async ({ params }) => {
		try {
			return { proposals: await proposeCovers(Number(params.id)) };
		} catch (error) {
			log.warn('música', 'No se pudieron buscar portadas', { albumId: params.id, error });
			return fail(503, { message: 'No se pudieron buscar portadas. Prueba otra vez.' });
		}
	},
	chooseCover: async ({ params, request }) => {
		const id = String((await request.formData()).get('releaseGroupId') ?? '');
		if (!/^[0-9a-f-]{36}$/.test(id)) return fail(400, { message: 'Portada no válida' });
		try {
			return { alsoFor: await chooseCover(Number(params.id), id) };
		} catch (error) {
			log.warn('música', 'No se pudo guardar la portada', { albumId: params.id, error });
			return fail(503, { message: 'No se pudo guardar la portada. Prueba otra vez.' });
		}
	},
	renameTrack: async ({ params, request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Canción no válida' });
		await renameTrack(Number(params.id), id, String(form.get('title') ?? '').trim());
	}
};
