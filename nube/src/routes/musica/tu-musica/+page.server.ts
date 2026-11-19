import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { ownCatalog, sourceView } from '#lib/server/own-music.ts';
import { ownPlaylists } from '#lib/server/own-music-lists.ts';

/**
 * Música's albums from the family's own bucket (#534), for the whole family, as it was read; only
 * for whom it is their source (Ajustes → Para mí, music-source.ts): else, the house's.
 */
export const load: PageServerLoad = async ({ locals, parent }) => {
	if ((await parent()).source !== 'propia') redirect(307, '/musica');
	const m = await withFamily(locals.user!.id, async (_, m) => m);
	const source = await sourceView(m.familyId);
	if (!source) redirect(307, '/musica');
	return {
		source,
		albums: await ownCatalog(m.familyId),
		/** For the «+» of each song: its own lists (#534, phase 2). */
		playlists: (await ownPlaylists(m.familyId)).map(({ id, name }) => ({ id, name })),
		admin: m.role === 'admin'
	};
};
