import type { LayoutServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { playlists } from '#lib/server/music.ts';

/**
 * Música (#253), as jellycartoon's: the house's, through its tunnel. Every page has the playlists,
 * for the «+» of each track; without the house, why not.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	try {
		const lists = await playlists({ id: locals.user!.id, email: locals.user!.email });
		return { playlists: lists.map((l) => ({ id: l.id, name: l.name })), houseProblem: null };
	} catch (error) {
		if (!(error instanceof HouseProblem)) throw error;
		return { playlists: [], houseProblem: error.message };
	}
};
