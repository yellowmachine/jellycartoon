import { browser } from '$app/env';
import type { PageLoad } from './$types';

/**
 * The games this device carries without coverage (offline-games.svelte.ts), from what it keeps:
 * the list in the browser only. Drawn on the server all the same, with no list, so that its HTML
 * carries the layout's data and opens with no network (offline-pages.ts).
 */
export const load: PageLoad = async () => {
	if (!browser) return {};
	const { offlineGames } = await import('#lib/offline-games.svelte.ts');
	await offlineGames.whenOpen().catch(() => {});
	return {};
};
