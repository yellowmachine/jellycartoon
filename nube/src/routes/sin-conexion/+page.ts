import { browser } from '$app/env';
import type { PageLoad } from './$types';

/**
 * Where the service worker sends a page with no network (offline-pages.ts), with what the device
 * keeps: that in the browser only. Drawn on the server all the same, so that its HTML carries the
 * layout's data and opens with none.
 */
export const load: PageLoad = async () => {
	if (!browser) return {};
	const { offlineGames } = await import('#lib/offline-games.svelte.ts');
	await offlineGames.whenOpen().catch(() => {});
	return {};
};
