import type { LayoutLoad } from './$types';
import { usePass } from '#lib/music-pass.svelte.ts';

/**
 * Series (#253): drawn in the browser only, as Música, as its thumbnails' addresses carry each
 * person's pass to the house (music-pass.svelte.ts). The pass, come with the server's data, first,
 * so they are right from the start.
 */
export const ssr = false;

export const load: LayoutLoad = ({ data }) => {
	if (data.pass) usePass(data.pass);
	return { passProblem: data.passProblem };
};
