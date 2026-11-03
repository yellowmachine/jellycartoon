import { XMLParser } from 'fast-xml-parser';
import { STATIONS, type Headline } from 'comun/radio.ts';
import { isWebUrl, plainText } from '#lib/server/podcasts/feed.ts';

/**
 * The headlines of the station playing (#387), from its broadcaster's own feed (comun/radio.ts):
 * RSS 2.0 or Atom, read here and kept a while, as every listener of a station asks for the same.
 * Only titles, their links (to the broadcaster's site) and when; a feed that fails, none.
 */

/** Kept this long: news feeds change every few minutes, headlines need not. */
const KEEP_MS = 15 * 60_000;
/** A failed one, asked again after this. */
const FAILED_MS = 2 * 60_000;
export const MAX_HEADLINES = 15;
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Seilide/1.0 (+https://seilide.app)';

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	textNodeName: '#text',
	isArray: (name) => name === 'item' || name === 'entry' || name === 'link'
});

function text(node: unknown): string | null {
	if (node === undefined || node === null) return null;
	if (Array.isArray(node)) return text(node[0]);
	if (typeof node === 'object') return text((node as Record<string, unknown>)['#text']);
	const value = String(node).trim();
	return value || null;
}

/** An item's or entry's link: RSS's text, or Atom's `href` (the `alternate` one, if several). */
function linkOf(node: unknown): string | null {
	const links = Array.isArray(node) ? node : [node];
	for (const l of links) {
		if (l && typeof l === 'object') {
			const rel = (l as Record<string, unknown>)['@_rel'];
			const href = text((l as Record<string, unknown>)['@_href']);
			if (href && (!rel || rel === 'alternate')) return href;
		}
		const plain = text(l);
		if (plain) return plain;
	}
	return null;
}

/**
 * Numeric character references left in a title (franceinfo sends «r&#xE9;sultats», escaped
 * twice): as the letters they are. Only valid code points.
 */
function numericEntities(value: string) {
	return value.replace(/&#(x[\da-f]+|\d+);/gi, (whole, code: string) => {
		const n = code[0] === 'x' || code[0] === 'X' ? parseInt(code.slice(1), 16) : Number(code);
		return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
	});
}

function isoOf(value: string | null) {
	if (!value) return null;
	const at = new Date(value);
	return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** The newest first, with a title and a web link; at most MAX_HEADLINES. */
export function parseHeadlines(xml: string): Headline[] {
	let doc: Record<string, unknown>;
	try {
		doc = parser.parse(xml);
	} catch {
		return [];
	}
	const rss = (doc.rss as { channel?: { item?: unknown[] } } | undefined)?.channel?.item;
	const atom = (doc.feed as { entry?: unknown[] } | undefined)?.entry;
	const items = (rss ?? atom ?? []) as Record<string, unknown>[];
	const headlines = items.flatMap((item) => {
		const title = plainText(text(item.title));
		const link = linkOf(item.link) ?? text(item.guid);
		if (!title || !isWebUrl(link)) return [];
		const at = isoOf(
			text(item.pubDate) ?? text(item.published) ?? text(item.updated) ?? text(item['dc:date'])
		);
		return [{ title: numericEntities(title).replace(/\s+/g, ' '), link, at }];
	});
	// Some feeds are not in order: the newest first, those without a date last.
	headlines.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
	return headlines.slice(0, MAX_HEADLINES);
}

const kept = new Map<string, { headlines: Headline[]; until: number }>();
const asking = new Map<string, Promise<Headline[]>>();

async function fetchHeadlines(feed: string) {
	try {
		const res = await fetch(feed, {
			headers: {
				'user-agent': USER_AGENT,
				accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml'
			},
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
		return parseHeadlines(await res.text());
	} catch (err) {
		console.warn('[radio] Sin titulares de', feed, String(err));
		return null;
	}
}

/** The station's headlines; null if it has no feed (an unknown station, or a music one). */
export async function stationHeadlines(uuid: string, now = Date.now()): Promise<Headline[] | null> {
	const feed = STATIONS.find((s) => s.uuid === uuid)?.feed;
	if (!feed) return null;
	const hit = kept.get(feed);
	if (hit && hit.until > now) return hit.headlines;
	let pending = asking.get(feed);
	if (!pending) {
		pending = fetchHeadlines(feed).then((read) => {
			// A failed one keeps the last it had, if any, a little longer.
			const headlines = read ?? hit?.headlines ?? [];
			kept.set(feed, { headlines, until: Date.now() + (read ? KEEP_MS : FAILED_MS) });
			return headlines;
		});
		asking.set(feed, pending);
		pending.finally(() => asking.delete(feed)).catch(() => {});
	}
	return pending;
}
