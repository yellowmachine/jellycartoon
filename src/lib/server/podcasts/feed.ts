import { XMLParser } from 'fast-xml-parser';

/**
 * A podcast's RSS feed, as the app keeps it: the podcast and its episodes with audio. The feed is
 * RSS 2.0 with Apple's `itunes:` tags, which every podcast has to have to be in their directory:
 * https://help.apple.com/itc/podcasts_connect/#/itcb54353390
 */

export interface FeedEpisode {
	guid: string;
	title: string;
	description: string | null;
	audioUrl: string;
	durationSec: number | null;
	publishedAt: Date | null;
	imageUrl: string | null;
}

export interface Feed {
	title: string;
	author: string | null;
	description: string | null;
	imageUrl: string | null;
	link: string | null;
	/** The newest first. */
	episodes: FeedEpisode[];
}

/** Some feeds have every episode since 2005; the newest are the ones anyone listens to. */
export const MAX_EPISODES = 500;

/** How much of a description is kept: enough to know what an episode is about. */
const DESCRIPTION_CHARS = 600;

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	textNodeName: '#text',
	isArray: (name) => name === 'item'
});

/** The text of a node, whether it has attributes (`<guid isPermaLink="false">`) or not. */
function text(node: unknown): string | null {
	if (node === undefined || node === null) return null;
	if (Array.isArray(node)) return text(node[0]);
	if (typeof node === 'object') return text((node as Record<string, unknown>)['#text']);
	const value = String(node).trim();
	return value || null;
}

/** Without its HTML, and short: descriptions come as web pages, with links and paragraphs. */
export function plainText(html: string | null) {
	if (!html) return null;
	const plain = html
		.replace(/<br\s*\/?>|<\/p>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/[ \t]+/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.trim();
	if (!plain) return null;
	return plain.length > DESCRIPTION_CHARS ? `${plain.slice(0, DESCRIPTION_CHARS - 1)}…` : plain;
}

/** `itunes:duration`: seconds (`3600`), or `MM:SS`, or `HH:MM:SS`. */
export function parseDuration(value: string | null) {
	if (!value) return null;
	const parts = value.split(':').map(Number);
	if (!parts.length || parts.length > 3 || parts.some((p) => !Number.isFinite(p))) return null;
	const sec = parts.reduce((total, p) => total * 60 + p, 0);
	return sec > 0 ? Math.round(sec) : null;
}

function date(value: string | null) {
	if (!value) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

const attr = (node: unknown, name: string) =>
	node && typeof node === 'object' ? text((node as Record<string, unknown>)[`@_${name}`]) : null;

/** Only http(s): what a browser can play, and nothing else the server would fetch. */
export function isWebUrl(value: string | null): value is string {
	if (!value) return false;
	try {
		return ['http:', 'https:'].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}

/** The feed, or why it is not one. */
export function parseFeed(xml: string): Feed {
	let doc;
	try {
		doc = parser.parse(xml);
	} catch {
		throw new Error('No es un feed RSS');
	}
	const channel = doc?.rss?.channel;
	if (!channel || typeof channel !== 'object') throw new Error('No es un feed RSS de podcast');
	const title = text(channel.title);
	if (!title) throw new Error('El feed no tiene título');
	const channelImage = attr(channel['itunes:image'], 'href') ?? text(channel.image?.url);

	const episodes: FeedEpisode[] = [];
	for (const item of (channel.item ?? []) as Record<string, unknown>[]) {
		const audioUrl = attr(item.enclosure, 'url');
		if (!isWebUrl(audioUrl)) continue;
		const itemImage = attr(item['itunes:image'], 'href');
		episodes.push({
			guid: text(item.guid) ?? audioUrl,
			title: text(item.title) ?? text(item['itunes:title']) ?? 'Sin título',
			description: plainText(text(item['itunes:summary']) ?? text(item.description)),
			audioUrl,
			durationSec: parseDuration(text(item['itunes:duration'])),
			publishedAt: date(text(item.pubDate)),
			imageUrl: isWebUrl(itemImage) ? itemImage : null
		});
	}
	episodes.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
	const link = text(channel.link);
	const seen = new Set<string>();

	return {
		title,
		author: text(channel['itunes:author']),
		description: plainText(text(channel['itunes:summary']) ?? text(channel.description)),
		imageUrl: isWebUrl(channelImage) ? channelImage : null,
		link: isWebUrl(link) ? link : null,
		// Two with the same guid (it happens): the newest.
		episodes: episodes
			.filter((e) => !seen.has(e.guid) && Boolean(seen.add(e.guid)))
			.slice(0, MAX_EPISODES)
	};
}
