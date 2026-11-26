/** One unread entry of a person's news reader, for the home page's card (#428, #638). */
export interface NewsItem {
	/** As the Google Reader API gives it: `tag:google.com,2005:reader/item/…`. */
	id: string;
	title: string;
	url: string;
	at: string | null;
	source: string | null;
	/** Its folder's name in the reader. */
	group: string | null;
}

/** One of their folders with something unread: a button on the card. */
export interface NewsGroup {
	/** Its name, as the reader gives it. */
	id: string;
	title: string;
	/** Unread in the reader, more than those on the card if there are many. */
	unread: number;
}

export interface NewsCard {
	/** Their reader's web. */
	url: string;
	/** The newest of each category, newest first: the card shows a few of them at a time. */
	items: NewsItem[];
	/** In the reader's order. */
	groups: NewsGroup[];
	/** `key`: it refuses the key, to change in Ajustes. `down`: not answering, and nothing to show. */
	problem: 'key' | 'down' | null;
}

/** The newest on the card at once. */
export const MAX_NEWS = 8;

/**
 * What the card shows for one of its buttons, without those already opened: `null` is «Todas», the
 * newest of every folder. A folder no longer on the card shows «Todas».
 */
export function newsShown(card: NewsCard, group: string | null, read: readonly string[] = []) {
	const known = card.groups.find((g) => g.id === group);
	return card.items
		.filter((i) => !read.includes(i.id))
		.filter((i) => !known || i.group === known.id)
		.slice(0, MAX_NEWS);
}

/** Unread in a folder, minus those opened here since the card came. */
export function newsUnread(card: NewsCard, group: NewsGroup, read: readonly string[] = []) {
	const opened = card.items.filter((i) => i.group === group.id && read.includes(i.id)).length;
	return Math.max(0, group.unread - opened);
}
