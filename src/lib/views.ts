/**
 * How some pages show their contents, chosen with a switch on the page. Per device (a grid suits a
 * wide screen, a list a phone), in a cookie so the server draws the page in the right view.
 */

/** The first value is the default. */
const VIEWS = {
	/** A series' episodes. */
	episodes: { cookie: 'jellycartoon-episode-view', values: ['list', 'grid'] },
	/** Música: albums, or artists with their albums inside. */
	music: { cookie: 'jellycartoon-music-view', values: ['albums', 'artists'] }
} as const;

type Kind = keyof typeof VIEWS;
export type View<K extends Kind> = (typeof VIEWS)[K]['values'][number];

export const viewCookie = (kind: Kind) => VIEWS[kind].cookie;

/** The cookie's value, or the default if it has none or an unknown one. */
export function parseView<K extends Kind>(kind: K, value: string | undefined): View<K> {
	const values: readonly string[] = VIEWS[kind].values;
	return (values.includes(value ?? '') ? value : values[0]) as View<K>;
}

/** In the browser: remembered for a year. */
export function saveView<K extends Kind>(kind: K, value: View<K>) {
	document.cookie = `${viewCookie(kind)}=${value}; path=/; max-age=31536000; samesite=lax`;
}
