import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import sanitizeHtml from 'sanitize-html';
import { fetchPublic } from '#lib/server/public-fetch.ts';
import type { NoteArticle } from '#lib/notes.ts';

/**
 * «Para leer» (#634): a web's article as Firefox's reader shows it (Mozilla's Readability, on
 * linkedom's DOM), sanitized to plain text with its headings, lists, quotes, code and links, and no
 * pictures. Null when it cannot be read from a server (a paywall, a site that blocks robots) or has
 * no article: the note keeps its name and the link.
 */

const PAGE_MS = 15_000;
const PAGE_BYTES = 5 * 1024 * 1024;
/** Kept at most: a long essay fits, a whole book does not. */
const MAX_HTML = 400_000;
const MAX_TEXT = 200_000;
const WORDS_A_MINUTE = 220;
const USER_AGENT = 'Mozilla/5.0 (compatible; Seilide/1.0; +https://seilide.app)';

/** What may stay: text and its shape, links to the web; nothing that runs, loads or styles. */
const ALLOWED: sanitizeHtml.IOptions = {
	allowedTags: [
		'p',
		'br',
		'hr',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'ul',
		'ol',
		'li',
		'blockquote',
		'pre',
		'code',
		'em',
		'strong',
		'b',
		'i',
		's',
		'sub',
		'sup',
		'a',
		'table',
		'thead',
		'tbody',
		'tr',
		'th',
		'td',
		'figcaption'
	],
	allowedAttributes: { a: ['href', 'rel', 'target'] },
	allowedSchemes: ['http', 'https', 'mailto'],
	// A heading of the page, below its own title: one level down.
	transformTags: {
		h1: 'h2',
		a: (tagName, attribs) => ({
			tagName,
			attribs: { ...attribs, rel: 'noopener noreferrer nofollow', target: '_blank' }
		})
	},
	nonTextTags: [
		'script',
		'style',
		'textarea',
		'option',
		'noscript',
		'svg',
		'iframe',
		'img',
		'picture'
	]
};

/** Sanitized again as it is shown: what was kept never runs, whatever the rules were then. */
export const safeArticleHtml = (html: string) => sanitizeHtml(html, ALLOWED);

/** The article of an HTML page at `url`, or null. Its links made whole against `url`. */
export function articleOf(html: string, url: string): NoteArticle | null {
	let read;
	try {
		const { document } = parseHTML(html);
		if (!document.documentElement) return null;
		// Readability reads relative links against the document's own address.
		const base = document.createElement('base');
		base.setAttribute('href', url);
		document.head?.prepend(base);
		read = new Readability(document as unknown as Document, { charThreshold: 300 }).parse();
	} catch {
		return null;
	}
	if (!read?.content || !read.textContent?.trim()) return null;
	const clean = sanitizeHtml(read.content, ALLOWED).trim();
	const text = read.textContent.replace(/\s+/g, ' ').trim();
	if (!clean || text.length < 200) return null;
	const words = text.split(' ').length;
	return {
		title: (read.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
		byline: read.byline?.replace(/\s+/g, ' ').trim().slice(0, 200) || null,
		site: read.siteName?.replace(/\s+/g, ' ').trim().slice(0, 100) || null,
		// Cut, it is sanitized again: no tag left open.
		html: clean.length > MAX_HTML ? sanitizeHtml(clean.slice(0, MAX_HTML), ALLOWED) : clean,
		text: text.slice(0, MAX_TEXT),
		minutes: Math.max(1, Math.round(words / WORDS_A_MINUTE))
	};
}

/** Downloaded and read; null, not readable. Never fails. */
export async function readArticle(url: string): Promise<NoteArticle | null> {
	try {
		const page = await fetchPublic(url, {
			maxBytes: PAGE_BYTES,
			timeoutMs: PAGE_MS,
			headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }
		});
		if (!/html/.test(page.contentType) && !/^\s*</.test(page.body)) return null;
		return articleOf(page.body, page.url);
	} catch {
		return null;
	}
}
