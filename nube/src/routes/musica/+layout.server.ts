import type { LayoutServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { musicPass, playlists } from '#lib/server/music.ts';

/**
 * Música (#253), as jellycartoon's: the house's, through its tunnel. Every page has the playlists,
 * for the «+» of each track; without the house, why not. And the pass for its songs and covers
 * (music-pass.svelte.ts), asked at the same time: from the browser after this it was a second
 * trip to the house, one after the other. Only to this person: Música is drawn in the browser.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	const who = { id: locals.user!.id, email: locals.user!.email };
	const [lists, pass] = await Promise.allSettled([playlists(who), musicPass(who)]);
	const problem = (result: PromiseSettledResult<unknown>) => {
		if (result.status === 'fulfilled') return null;
		if (!(result.reason instanceof HouseProblem)) throw result.reason;
		return result.reason.message;
	};
	return {
		playlists:
			lists.status === 'fulfilled' ? lists.value.map((l) => ({ id: l.id, name: l.name })) : [],
		houseProblem: problem(lists),
		pass: pass.status === 'fulfilled' ? pass.value : null,
		passProblem: problem(pass)
	};
};
