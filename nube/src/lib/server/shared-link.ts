import { findRecipe, readPage } from '#lib/server/recipes/schema-org.ts';
import { fetchPublic } from '#lib/server/public-fetch.ts';
import { isWebUrl, parseFeed } from '#lib/server/podcasts/feed.ts';

/**
 * «¿Qué hago con este enlace?» (#633): what a shared link is, to offer first what it most likely
 * is for. A recipe, if its page has one (schema.org Recipe); a podcast, if it is its feed, a page
 * that links to it (iVoox, a programme's own) or Apple Podcasts' (its feed, from Apple). The
 * computer's bookmark says both from the page itself; shared from a phone, the page is read here.
 * Never fails: what cannot be read is said as nothing.
 */

export interface LinkHints {
	/** From the bookmark: whether the page has a recipe, and the feed it links to. Null, not said. */
	recipe: boolean | null;
	feed: string | null;
}

export interface FoundPodcast {
	feedUrl: string;
	title: string;
	imageUrl: string | null;
}

export interface LinkKinds {
	recipe: boolean;
	podcast: FoundPodcast | null;
}

/** Read quickly: the page waits for it. */
const PAGE_MS = 5_000;
const PAGE_BYTES = 3 * 1024 * 1024;
const FEED_BYTES = 20 * 1024 * 1024;
const USER_AGENT = 'Seilide/1.0 (+https://seilide.app)';

/** Apple Podcasts' id in its address: «…/id1234567890». */
export function appleId(link: string) {
	try {
		const url = new URL(link);
		if (url.hostname !== 'podcasts.apple.com') return null;
		return url.pathname.match(/\/id(\d+)/)?.[1] ?? null;
	} catch {
		return null;
	}
}

/** The feed a page links to as its RSS or Atom: `<link rel="alternate" type="application/rss+xml">`. */
export async function feedLinkOf(html: string, base: string) {
	let href: string | null = null;
	await new HTMLRewriter()
		.on('link[rel="alternate"]', {
			element(el) {
				const type = el.getAttribute('type') ?? '';
				if (href || !/application\/(rss|atom)\+xml/.test(type)) return;
				href = el.getAttribute('href');
			}
		})
		.transform(new Response(html))
		.text();
	if (!href) return null;
	try {
		const url = new URL(href, base).href;
		return isWebUrl(url) ? url : null;
	} catch {
		return null;
	}
}

const looksLikeFeed = (body: string, type: string) =>
	/xml|rss|atom/.test(type) || /^\s*(<\?xml[^>]*>\s*)?<(rss|feed)\b/.test(body);

/** A feed with episodes to listen to; null, not a podcast (a blog's RSS) or not read. */
async function podcastOf(feedUrl: string, body?: string): Promise<FoundPodcast | null> {
	try {
		const xml =
			body ??
			(
				await fetchPublic(feedUrl, {
					maxBytes: FEED_BYTES,
					timeoutMs: PAGE_MS,
					headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml' }
				})
			).body;
		const feed = parseFeed(xml);
		return feed.episodes.length ? { feedUrl, title: feed.title, imageUrl: feed.imageUrl } : null;
	} catch {
		return null;
	}
}

/** Apple Podcasts' feed, by its own lookup (as the search in Radio → Podcasts). */
async function appleFeed(id: string) {
	try {
		const res = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=podcast`, {
			headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
			signal: AbortSignal.timeout(PAGE_MS)
		});
		if (!res.ok) return null;
		const { results } = (await res.json()) as { results?: { feedUrl?: string }[] };
		const feedUrl = results?.find((r) => r.feedUrl)?.feedUrl ?? null;
		return isWebUrl(feedUrl) ? feedUrl : null;
	} catch {
		return null;
	}
}

export async function linkKinds(link: string, hints: LinkHints): Promise<LinkKinds> {
	const apple = appleId(link);
	if (apple) {
		const feedUrl = await appleFeed(apple);
		return { recipe: false, podcast: feedUrl ? await podcastOf(feedUrl) : null };
	}
	// The bookmark already read the page.
	if (hints.recipe !== null)
		return {
			recipe: hints.recipe,
			podcast: hints.feed && isWebUrl(hints.feed) ? await podcastOf(hints.feed) : null
		};
	let page;
	try {
		page = await fetchPublic(link, {
			maxBytes: PAGE_BYTES,
			timeoutMs: PAGE_MS,
			headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, application/rss+xml, */*' }
		});
	} catch {
		return { recipe: false, podcast: null };
	}
	if (looksLikeFeed(page.body, page.contentType))
		return { recipe: false, podcast: await podcastOf(page.url, page.body) };
	const [read, feed] = await Promise.all([
		readPage(page.body).catch(() => null),
		feedLinkOf(page.body, page.url).catch(() => null)
	]);
	return {
		recipe: Boolean(read && findRecipe(read.jsonLd)),
		podcast: feed ? await podcastOf(feed) : null
	};
}
