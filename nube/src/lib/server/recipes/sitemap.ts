import { XMLParser } from 'fast-xml-parser';

/**
 * A favourite cooking site's map (#60): the pages it lists in its sitemaps (the sitemaps.org
 * protocol, https://www.sitemaps.org/protocol.html), found as robots.txt says
 * (https://www.sitemaps.org/protocol.html#submit_robots) or where sites usually leave them. Sitemaps
 * have no titles: a recipe's address does, in words («/macarrones-gratinados-con-bechamel»).
 */

/** Where sites usually leave it, when robots.txt does not say: WordPress and its plugins. */
export const USUAL_SITEMAPS = ['/sitemap_index.xml', '/sitemap.xml', '/wp-sitemap.xml'];

/** The sitemaps robots.txt lists: `Sitemap: https://…`. */
export function sitemapsInRobots(robots: string) {
	return [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!);
}

/**
 * robots.txt's Crawl-delay, in seconds: the one for us (a user-agent with «jellycartoon» in it), or
 * the one for every bot (`*`); null if it says none. Not in the standard (RFC 9309), but many
 * sites use it: https://en.wikipedia.org/wiki/Robots.txt#Crawl-delay_directive
 */
export function crawlDelay(robots: string): number | null {
	const delays = new Map<string, number>();
	let agents: string[] = [];
	let inRules = false;
	for (const raw of robots.split(/\r?\n/)) {
		const line = raw.replace(/#.*/, '').trim();
		const colon = line.indexOf(':');
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();
		if (key === 'user-agent') {
			// A user-agent after rules starts another group.
			if (inRules) agents = [];
			inRules = false;
			agents.push(value.toLowerCase());
		} else {
			inRules = true;
			const seconds = Number(value);
			if (key === 'crawl-delay' && Number.isFinite(seconds) && seconds >= 0)
				for (const agent of agents) delays.set(agent, seconds);
		}
	}
	const ours = [...delays].find(([agent]) => agent.includes('jellycartoon'));
	return ours?.[1] ?? delays.get('*') ?? null;
}

const parser = new XMLParser({
	ignoreAttributes: true,
	removeNSPrefix: true,
	isArray: (name) => name === 'sitemap' || name === 'url'
});

/** A sitemap listed in an index, with when it last changed, if the index says. */
export interface SitemapEntry {
	url: string;
	lastmod: string | null;
}

/** A sitemap index's sitemaps, or a sitemap's pages; null if it is neither. */
export function parseSitemap(xml: string): { sitemaps: SitemapEntry[]; pages: string[] } | null {
	let doc: Record<string, unknown>;
	try {
		doc = parser.parse(xml);
	} catch {
		return null;
	}
	const locs = (list: unknown) =>
		(Array.isArray(list) ? list : []).flatMap((entry) => {
			const loc = (entry as { loc?: unknown })?.loc;
			return typeof loc === 'string' && loc.trim() ? [loc.trim()] : [];
		});
	const index = doc.sitemapindex as { sitemap?: unknown } | undefined;
	if (index)
		return {
			sitemaps: (Array.isArray(index.sitemap) ? index.sitemap : []).flatMap((entry) => {
				const { loc, lastmod } = (entry ?? {}) as { loc?: unknown; lastmod?: unknown };
				return typeof loc === 'string' && loc.trim()
					? [{ url: loc.trim(), lastmod: lastmod ? String(lastmod).trim() : null }]
					: [];
			}),
			pages: []
		};
	const set = doc.urlset as { url?: unknown } | undefined;
	if (set) return { sitemaps: [], pages: locs(set.url) };
	return null;
}

/**
 * Sitemaps that are not of recipes, by the exact names WordPress and its plugins (Yoast, Rank Math)
 * give them: images, videos, categories, tags, authors, static pages. Not any «category» in the
 * address: some sites keep their posts in sitemaps by category (`/categoria/pasta/sitemap.xml`).
 */
export const skipSitemap = (url: string) =>
	/(image|video|(category|post_tag|tag|author|page)-sitemap|wp-sitemap-(users|taxonomies)|sitemap-misc)/i.test(
		url
	);

/** Lower case and no accents, for searching: «Gratinados» and «gratinados», «Bechamel» and «bechamél». */
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The words of a page's address, its title for searching: the last part of its path, without the
 * extension nor the ids some sites add («_1_5842309»). Null if it has no words (a `?p=123`).
 */
export function slugTitle(page: string): string | null {
	let url: URL;
	try {
		url = new URL(page);
	} catch {
		return null;
	}
	const parts = url.pathname.split('/').filter(Boolean);
	for (const part of parts.toReversed()) {
		const words = decodeURIComponent(part)
			.replace(/\.[a-z]+$/i, '')
			.split(/[-_+\s]+/)
			.filter((w) => /\p{L}/u.test(w) && !/^\d+$/.test(w));
		if (words.length >= 2) {
			const text = words.join(' ');
			return text[0]!.toUpperCase() + text.slice(1);
		}
	}
	return null;
}

/** Words that say nothing in a search: «receta de macarrones con queso» is «macarrones queso». */
const STOPWORDS = new Set(
	'de del la las el los con y a al en receta recetas para un una unos unas mi mis tu como hacer o'.split(
		' '
	)
);

/**
 * A search's words, folded and without the empty ones, each as its root («macarrones» →
 * «macarron», «patatas» → «patata»), so that singular and plural both match.
 */
export function searchWords(query: string) {
	return fold(query)
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length > 1 && !STOPWORDS.has(w))
		.map((w) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w));
}
