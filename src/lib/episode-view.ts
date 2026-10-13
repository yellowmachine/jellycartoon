/**
 * How a series page shows its episodes: a list or a grid of thumbnails. Per device (a grid suits a
 * wide screen, a list a phone), in a cookie so the server draws the page in the right view.
 */

export const EPISODE_VIEW_COOKIE = 'jellycartoon-episode-view';

export type EpisodeView = 'list' | 'grid';

export function parseEpisodeView(value: string | undefined): EpisodeView {
	return value === 'grid' ? 'grid' : 'list';
}

/** In the browser: remembered for a year. */
export function saveEpisodeView(value: EpisodeView) {
	document.cookie = `${EPISODE_VIEW_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
}
