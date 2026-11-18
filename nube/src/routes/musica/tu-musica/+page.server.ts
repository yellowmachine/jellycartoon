import type { PageServerLoad } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { ownCatalog, sourceView } from '#lib/server/own-music.ts';
import { ownPlaylists } from '#lib/server/own-music-lists.ts';

/** «Tu música» (#534): the family's bucket as it was read, for the whole family. */
export const load: PageServerLoad = async ({ locals }) => {
	const m = await withFamily(locals.user!.id, async (_, m) => m);
	const source = await sourceView(m.familyId);
	return {
		source,
		albums: source ? await ownCatalog(m.familyId) : [],
		/** For the «+» of each song: its own lists (#534, phase 2). */
		playlists: source ? (await ownPlaylists(m.familyId)).map(({ id, name }) => ({ id, name })) : [],
		admin: m.role === 'admin'
	};
};
