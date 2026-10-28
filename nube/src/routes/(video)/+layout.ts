import type { LayoutLoad } from './$types';
import { askPass } from '#lib/music-pass.svelte.ts';

/**
 * Series (#253): drawn in the browser only, as Música, as its thumbnails' addresses carry each
 * person's pass to the house (music-pass.svelte.ts). The pass first, so they are right from the
 * start.
 */
export const ssr = false;

export const load: LayoutLoad = async ({ fetch }) => ({ passProblem: await askPass(fetch) });
