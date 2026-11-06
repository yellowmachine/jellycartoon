/** One unread entry of a person's Miniflux, for the home page's card (#428). */
export interface NewsItem {
	id: number;
	title: string;
	url: string;
	at: string | null;
	source: string | null;
}

export interface NewsCard {
	/** Their Miniflux. */
	url: string;
	items: NewsItem[];
	/** `key`: it refuses the key, to change in Ajustes. `down`: not answering, and nothing to show. */
	problem: 'key' | 'down' | null;
}
