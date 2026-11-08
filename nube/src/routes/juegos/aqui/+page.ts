import type { PageLoad } from './$types';

/**
 * The games this device carries without coverage (offline-games.svelte.ts): drawn in the browser
 * only, from what it keeps, so that it opens with no network, as long as the app is open.
 */
export const ssr = false;

export const load: PageLoad = async () => {
	const { offlineGames } = await import('#lib/offline-games.svelte.ts');
	await offlineGames.whenOpen().catch(() => {});
	return {};
};
