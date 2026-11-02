import { redirect } from '@sveltejs/kit';
import { musicRoot, videoEnabled } from '#lib/server/library/paths.ts';
import type { LayoutServerLoad } from './$types';

/** A house without video (#378): no series, so its pages (the home page too) go to the music. */
export const load: LayoutServerLoad = () => {
	if (!videoEnabled) redirect(307, musicRoot ? '/musica' : '/radio');
};
