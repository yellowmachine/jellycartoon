import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { ownFolder } from '#lib/server/own-music.ts';
import { ownPlaylists } from '#lib/server/own-music-lists.ts';

/**
 * Música → Carpetas from the family's own bucket (#534, phase 3), when it is this person's source:
 * a folder of it as it was read, as the house's Carpetas.
 */
export const load: PageServerLoad = async ({ url, locals, parent }) => {
	if ((await parent()).source !== 'propia') redirect(307, `/musica/carpetas${url.search}`);
	const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
	const folder = await ownFolder(familyId, url.searchParams.get('ruta') ?? '');
	if (!folder) error(404, 'No hay esa carpeta');
	return {
		folder,
		/** For the «+» of each song: its own lists (#534, phase 2). */
		playlists: (await ownPlaylists(familyId)).map(({ id, name }) => ({ id, name }))
	};
};
