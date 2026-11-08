import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** A game this device carries, played with what it keeps (offline-games.svelte.ts). */
export const ssr = false;

export const load: PageLoad = async ({ params }) => {
	const { offlineGames } = await import('#lib/offline-games.svelte.ts');
	await offlineGames.whenOpen().catch(() => {});
	const game = offlineGames.find(params.system, params.file);
	if (!game || !offlineGames.isReady(game)) error(404, 'Este juego no está en este dispositivo');
	return { player: game.player };
};
