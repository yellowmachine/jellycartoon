import type { LayoutServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { musicPass } from '#lib/server/music.ts';

/**
 * The pass for the episodes' thumbnails and the series' backgrounds (music-pass.svelte.ts), asked
 * at the same time as each page's own data from the house: from the browser after these it was a
 * second trip, one after the other (as Música's). Only to this person: Series is drawn in the
 * browser.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	try {
		return {
			pass: await musicPass({ id: locals.user!.id, email: locals.user!.email }),
			passProblem: null
		};
	} catch (error) {
		if (!(error instanceof HouseProblem)) throw error;
		return { pass: null, passProblem: error.message };
	}
};
