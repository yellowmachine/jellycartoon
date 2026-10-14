import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { musicRoot } from '#lib/server/library/paths.ts';
import { getAlbums, renameAlbum, renameTrack, tagTitles } from '#lib/server/music/albums.ts';

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
		await renameAlbum(Number(params.id), title);
	},
	renameTrack: async ({ params, request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Canción no válida' });
		await renameTrack(Number(params.id), id, String(form.get('title') ?? '').trim());
	}
};
