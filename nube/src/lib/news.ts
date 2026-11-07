/** One unread entry of a person's Miniflux, for the home page's card (#428). */
export interface NewsItem {
	id: number;
	title: string;
	url: string;
	at: string | null;
	source: string | null;
	/** Its Miniflux category's id. */
	group: number | null;
}

/** One of their Miniflux categories with something unread: a button on the card. */
export interface NewsGroup {
	id: number;
	title: string;
	/** Unread in Miniflux, more than those on the card if there are many. */
	unread: number;
	/** «Hide entries in the global unread list», in Miniflux: not under «Todas». */
	hidden: boolean;
}

export interface NewsCard {
	/** Their Miniflux. */
	url: string;
	/** The newest of each category, newest first: the card shows a few of them at a time. */
	items: NewsItem[];
	/** In Miniflux's order. */
	groups: NewsGroup[];
	/** `key`: it refuses the key, to change in Ajustes. `down`: not answering, and nothing to show. */
	problem: 'key' | 'down' | null;
}

/** The newest on the card at once. */
export const MAX_NEWS = 8;

/**
 * What the card shows for one of its buttons, without those already opened: `null` is «Todas», the
 * newest of every category not hidden in Miniflux. A category no longer on the card shows «Todas».
 */
export function newsShown(card: NewsCard, group: number | null, read: readonly number[] = []) {
	const known = card.groups.find((g) => g.id === group);
	const hidden = new Set(card.groups.filter((g) => g.hidden).map((g) => g.id));
	return card.items
		.filter((i) => !read.includes(i.id))
		.filter((i) => (known ? i.group === known.id : i.group === null || !hidden.has(i.group)))
		.slice(0, MAX_NEWS);
}

/** Unread in a category, minus those opened here since the card came. */
export function newsUnread(card: NewsCard, group: NewsGroup, read: readonly number[] = []) {
	const opened = card.items.filter((i) => i.group === group.id && read.includes(i.id)).length;
	return Math.max(0, group.unread - opened);
}
