import type { PageServerLoad } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { ownCatalog, sourceView } from '#lib/server/own-music.ts';

/** «Tu música» (#534): the family's bucket as it was read, for the whole family. */
export const load: PageServerLoad = async ({ locals }) => {
	const m = await withFamily(locals.user!.id, async (_, m) => m);
	const source = await sourceView(m.familyId);
	return {
		source,
		albums: source ? await ownCatalog(m.familyId) : [],
		admin: m.role === 'admin'
	};
};
