import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** A game this device carries, played with what it keeps (offline-games.svelte.ts). */
export const ssr = false;

export const load: PageLoad = async ({ params, url }) => {
	const { offlineGames } = await import('#lib/offline-games.svelte.ts');
	await offlineGames.whenOpen().catch(() => {});
	// The bucket's (#564), `?de=propia`; else the house's.
	const source = url.searchParams.get('de') === 'propia' ? 'propia' : 'casa';
	const game = offlineGames.find(params.system, params.file, source);
	if (!game || !offlineGames.isReady(game)) error(404, 'Este juego no está en este dispositivo');
	return { player: game.player };
};
