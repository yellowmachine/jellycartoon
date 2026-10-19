import { and, asc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { recipeSite, recipeSitePage } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import { fetchPublic } from '#lib/server/public-fetch.ts';
import { readPage } from './schema-org.ts';
import {
	fold,
	parseSitemap,
	searchWords,
	sitemapsInRobots,
	skipSitemap,
	slugTitle,
	USUAL_SITEMAPS
} from './sitemap.ts';

/**
 * The house's favourite cooking sites (#60): added by any page of theirs, their sitemaps read in
 * the background (and again every week, at night), and their recipes searched by the words of
 * their addresses. Choosing one imports it into the book (import.ts).
 */

const USER_AGENT = 'JellyCartoon/1.0 (https://github.com/yellowmachine/jellycartoon)';
/** The protocol's own limit for one sitemap, unpacked: https://www.sitemaps.org/protocol.html */
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const MAX_SITEMAPS = 300;
const MAX_PAGES = 100_000;
/** Between one sitemap and the next: a site is not a race. */
const PAUSE_MS = 300;
const REFRESH_DAYS = 7;

const headers = { 'User-Agent': USER_AGENT };

/** Sites whose sitemaps are being read now. */
const indexing = new Map<number, Promise<void>>();

export const isIndexing = (siteId: number) => indexing.has(siteId);

const hostOf = (url: URL) => url.hostname.replace(/^www\./, '');

/** A site, by any of its pages; the one there was, if it was added already. */
export async function addRecipeSite(address: string, userId: string) {
	let url: URL;
	try {
		url = new URL(address.trim());
	} catch {
		throw new Error('Eso no es una dirección web');
	}
	const host = hostOf(url);
	const [existing] = await db
		.select({ id: recipeSite.id })
		.from(recipeSite)
		.where(eq(recipeSite.host, host));
	if (existing) return existing.id;
	// Its home page, for its name: and to know it is there.
	const home = await fetchPublic(`${url.protocol}//${url.host}/`, {
		headers,
		maxBytes: 5_000_000
	});
	const page = await readPage(home.body);
	const [row] = await db
		.insert(recipeSite)
		.values({
			host,
			name: page.siteName ?? page.title?.split(/\s[|–—-]\s/)[0] ?? host,
			createdBy: userId
		})
		.onConflictDoNothing()
		.returning({ id: recipeSite.id });
	if (!row) return addRecipeSite(address, userId);
	void indexSite(row.id);
	return row.id;
}

/** Its sitemaps, read again; resolves when done. Twice at once is once. */
export function indexSite(siteId: number) {
	let running = indexing.get(siteId);
	if (!running) {
		running = readSitemaps(siteId).finally(() => indexing.delete(siteId));
		indexing.set(siteId, running);
	}
	return running;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

async function readSitemaps(siteId: number) {
	const [site] = await db.select().from(recipeSite).where(eq(recipeSite.id, siteId));
	if (!site) return;
	try {
		const origin = `https://${site.host}`;
		const robots = await fetchPublic(`${origin}/robots.txt`, { headers, maxBytes: 500_000 })
			.then((r) => sitemapsInRobots(r.body))
			.catch(() => []);
		// Listed in robots.txt: all of them. If not, the first of the usual places that is one.
		const queue = robots.length ? robots : USUAL_SITEMAPS.map((p) => origin + p);
		const firstOnly = !robots.length;
		const seen = new Set<string>();
		const pages = new Map<string, string>();
		while (queue.length && seen.size < MAX_SITEMAPS && pages.size < MAX_PAGES) {
			const address = queue.shift()!;
			if (seen.has(address) || skipSitemap(address)) continue;
			seen.add(address);
			const read = await fetchPublic(address, {
				headers,
				maxBytes: MAX_SITEMAP_BYTES,
				timeoutMs: 60_000
			})
				.then((r) => parseSitemap(r.body))
				.catch(() => null);
			await pause();
			if (!read) continue;
			queue.push(...read.sitemaps);
			for (const page of read.pages) {
				let url: URL;
				try {
					url = new URL(page);
				} catch {
					continue;
				}
				// Only the site's own pages: a sitemap may list others.
				if (!(hostOf(url) === site.host || url.hostname.endsWith(`.${site.host}`))) continue;
				const title = slugTitle(page);
				if (title && pages.size < MAX_PAGES) pages.set(url.href, title);
			}
			if (firstOnly && (read.pages.length || read.sitemaps.length)) queue.length = 0;
		}
		if (!pages.size)
			throw new Error(
				seen.size ? 'Su mapa no tiene recetas que se puedan buscar' : 'No tiene mapa del sitio'
			);
		const rows = [...pages].map(([url, title]) => ({
			siteId,
			url,
			title,
			words: ` ${fold(title)} `
		}));
		await db.transaction(async (tx) => {
			await tx.delete(recipeSitePage).where(eq(recipeSitePage.siteId, siteId));
			for (let i = 0; i < rows.length; i += 1000)
				await tx
					.insert(recipeSitePage)
					.values(rows.slice(i, i + 1000))
					.onConflictDoNothing();
			await tx
				.update(recipeSite)
				.set({ pages: rows.length, indexedAt: new Date(), lastError: null })
				.where(eq(recipeSite.id, siteId));
		});
		log.info('recetas', `Leído el mapa de ${site.name}: ${rows.length} páginas`, {
			siteId,
			sitemaps: seen.size
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await db
			.update(recipeSite)
			.set({ indexedAt: new Date(), lastError: message })
			.where(eq(recipeSite.id, siteId));
		log.warn('recetas', `No se pudo leer el mapa de ${site.name}: ${message}`, { siteId });
	}
}

/** Those read more than a week ago (or never), one after the other: at night. */
export async function refreshRecipeSites() {
	const stale = await db
		.select({ id: recipeSite.id })
		.from(recipeSite)
		.where(
			or(
				isNull(recipeSite.indexedAt),
				lt(recipeSite.indexedAt, new Date(Date.now() - REFRESH_DAYS * 86_400_000))
			)
		);
	for (const { id } of stale) await indexSite(id);
}

export async function listRecipeSites() {
	const sites = await db.select().from(recipeSite).orderBy(asc(recipeSite.name));
	return sites.map((s) => ({ ...s, indexing: isIndexing(s.id) }));
}

export async function removeRecipeSite(siteId: number) {
	await db.delete(recipeSite).where(eq(recipeSite.id, siteId));
}

/**
 * Pages of the favourite sites (or of one) with every word of `query` in their address, the
 * closest first: those that say «receta» (a site's articles are in its maps too), then the
 * shortest, which say less besides.
 */
export async function searchRecipeSites(query: string, siteId?: number, limit = 8) {
	const words = searchWords(query);
	if (!words.length) return [];
	return db
		.select({
			url: recipeSitePage.url,
			title: recipeSitePage.title,
			site: recipeSite.name
		})
		.from(recipeSitePage)
		.innerJoin(recipeSite, eq(recipeSite.id, recipeSitePage.siteId))
		.where(
			and(
				siteId === undefined ? undefined : eq(recipeSitePage.siteId, siteId),
				// Each word at the start of one: «pan» is not «empanada».
				...words.map((w) => ilike(recipeSitePage.words, `% ${w}%`))
			)
		)
		.orderBy(
			sql`${recipeSitePage.words} not like '% receta%'`,
			sql`length(${recipeSitePage.words})`,
			asc(recipeSitePage.title)
		)
		.limit(limit);
}

/** Whether a page is one of a favourite site's: only those are imported by voice. */
export async function isFavouritePage(url: string) {
	const [found] = await db
		.select({ id: recipeSitePage.id })
		.from(recipeSitePage)
		.where(eq(recipeSitePage.url, url))
		.limit(1);
	return Boolean(found);
}
