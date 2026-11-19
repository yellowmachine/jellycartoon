import type { LayoutServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { musicPass, playlists } from '#lib/server/music.ts';
import { musicSources } from '#lib/server/music-source.ts';

/**
 * Música (#253), as jellycartoon's: the house's, through its tunnel. Every page has the playlists,
 * for the «+» of each track; without the house, why not. And the pass for its songs and covers
 * (music-pass.svelte.ts), asked at the same time: from the browser after this it was a second
 * trip to the house, one after the other. Only to this person: Música is drawn in the browser.
 *
 * Or the family's own bucket («Tu música», #534), if that is this person's source (Ajustes → Para
 * mí, music-source.ts): then nothing is asked of the house, and its pages have their own lists.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	const source = (await musicSources(locals.user!.id)).current;
	if (source === 'propia')
		return { source, playlists: [], houseProblem: null, pass: null, passProblem: null };
	const who = { id: locals.user!.id, email: locals.user!.email };
	const [lists, pass] = await Promise.allSettled([playlists(who), musicPass(who)]);
	const problem = (result: PromiseSettledResult<unknown>) => {
		if (result.status === 'fulfilled') return null;
		if (!(result.reason instanceof HouseProblem)) throw result.reason;
		return result.reason.message;
	};
	return {
		source,
		playlists:
			lists.status === 'fulfilled' ? lists.value.map((l) => ({ id: l.id, name: l.name })) : [],
		houseProblem: problem(lists),
		pass: pass.status === 'fulfilled' ? pass.value : null,
		passProblem: problem(pass)
	};
};
