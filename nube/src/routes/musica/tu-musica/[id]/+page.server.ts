import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { ownCatalog } from '#lib/server/own-music.ts';

/** An album of «Tu música» (#534), with its tracks. */
export const load: PageServerLoad = async ({ params, locals }) => {
	const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
	const ownAlbum = (await ownCatalog(familyId)).find((a) => a.id === Number(params.id));
	if (!ownAlbum) error(404, 'Ese álbum no está');
	return { ownAlbum };
};
