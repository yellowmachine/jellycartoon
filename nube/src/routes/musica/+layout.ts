import type { LayoutLoad } from './$types';
import { usePass } from '#lib/music-pass.svelte.ts';

/**
 * Drawn in the browser only: the covers' addresses carry each person's pass to the house
 * (music-pass.svelte.ts), which a page drawn on the server must not share. The pass, come with
 * the server's data, first, so they are right from the start.
 */
export const ssr = false;

export const load: LayoutLoad = ({ data }) => {
	if (data.pass) usePass(data.pass);
	return { ...data, passProblem: data.houseProblem ? null : data.passProblem };
};
