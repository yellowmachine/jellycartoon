import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { ownCatalog, renameAlbum } from '#lib/server/own-music.ts';

/** An album of «Tu música» (#534), with its tracks; the grown-ups can rename it. */
export const load: PageServerLoad = async ({ params, locals }) => {
	const m = await withFamily(locals.user!.id, async (_, m) => m);
	const ownAlbum = (await ownCatalog(m.familyId)).find((a) => a.id === Number(params.id));
	if (!ownAlbum) error(404, 'Ese álbum no está');
	return { ownAlbum, canEdit: m.role !== 'peque' };
};

export const actions: Actions = {
	/** Its title and artist as the family wants them; empty, back to its tags'. */
	rename: async ({ params, request, locals }) => {
		const m = await withFamily(locals.user!.id, async (_, m) => m);
		if (m.role === 'peque') return fail(403, { problem: 'Solo los mayores' });
		const form = await request.formData();
		const text = (name: string) =>
			String(form.get(name) ?? '')
				.replace(/\s+/g, ' ')
				.trim();
		const album = (await ownCatalog(m.familyId)).find((a) => a.id === Number(params.id));
		if (!album) return fail(404, { problem: 'Ese álbum no está' });
		const tags = album.tags ?? { title: album.title, artist: album.artist };
		const title = text('title') || tags.title;
		const artist = text('artist') || tags.artist;
		if (title.length > 300 || artist.length > 300) return fail(400, { problem: 'Demasiado largo' });
		await renameAlbum(m.familyId, album.id, { title, artist });
		return { renamed: true };
	}
};
