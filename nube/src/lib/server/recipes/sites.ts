import { and, asc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { recipeSite, recipeSitePage, recipeSiteSitemap } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { FetchError, fetchPublic } from '#lib/server/public-fetch.ts';
import { readPage } from './schema-org.ts';
import {
	crawlDelay,
	fold,
	parseSitemap,
	searchWords,
	sitemapsInRobots,
	skipSitemap,
	slugTitle,
	USUAL_SITEMAPS,
	type SitemapEntry
} from './sitemap.ts';

/**
 * The family's favourite cooking sites (#253; jellycartoon's #60): added by any page of theirs,
 * their sitemaps read in the background, and their recipes searched by the words of their
 * addresses. Choosing one imports it into the book (import.ts). Read again after a week, not at
 * night as at home (the app cannot go through every family's): when the family opens Recetas or
 * its voice searches them (`refreshStale`).
 */

const USER_AGENT = 'Nube/1.0 (https://github.com/yellowmachine/jellycartoon)';
/** The protocol's own limit for one sitemap, unpacked: https://www.sitemaps.org/protocol.html */
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
/** Asked for in one reading: a site with more is read in parts, a part each night. */
const MAX_SITEMAPS = 1000;
const MAX_PAGES = 100_000;
/** Between one sitemap and the next, at least: a site is not a race. */
const PAUSE_MS = 1000;
/** A Crawl-delay longer than this is taken as this: a reading would never end. */
const MAX_PAUSE_MS = 30_000;
const REFRESH_DAYS = 7;

const headers = { 'User-Agent': USER_AGENT };

/** Sites whose sitemaps are being read now. */
const indexing = new Map<number, Promise<void>>();

/**
 * How the reading of each goes, for Recetas to show it: sitemaps done of those known so far (an
 * index can bring more), and the pages found in them.
 */
const progress = new Map<number, { done: number; total: number; pages: number }>();

export const isIndexing = (siteId: number) => indexing.has(siteId);

const hostOf = (url: URL) => url.hostname.replace(/^www\./, '');

/** A site, by any of its pages; the one there was, if it was added already. */
export async function addRecipeSite(k: Kitchen, address: string): Promise<number> {
	let url: URL;
	try {
		url = new URL(address.trim());
	} catch {
		throw new Error('Eso no es una dirección web');
	}
	const host = hostOf(url);
	const [existing] = await k.run((tx) =>
		tx.select({ id: recipeSite.id }).from(recipeSite).where(eq(recipeSite.host, host))
	);
	if (existing) return existing.id;
	// Its home page, for its name: and to know it is there.
	const home = await fetchPublic(`${url.protocol}//${url.host}/`, {
		headers,
		maxBytes: 5_000_000
	});
	const page = await readPage(home.body);
	const [row] = await k.run((tx) =>
		tx
			.insert(recipeSite)
			.values({
				familyId: k.familyId,
				host,
				name: page.siteName ?? page.title?.split(/\s[|–—-]\s/)[0] ?? host,
				createdBy: k.userId
			})
			.onConflictDoNothing()
			.returning({ id: recipeSite.id })
	);
	if (!row) return addRecipeSite(k, address);
	void indexSite(k, row.id);
	return row.id;
}

/** Its sitemaps, read again; resolves when done. Twice at once is once. */
export function indexSite(k: Kitchen, siteId: number) {
	let running = indexing.get(siteId);
	if (!running) {
		running = readSitemaps(k, siteId).finally(() => {
			indexing.delete(siteId);
			progress.delete(siteId);
		});
		indexing.set(siteId, running);
	}
	return running;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The site asked to stop (429), or refused (403) or could not (503): nothing more is asked of it
 * now, nothing read so far is kept, and it is tried again the next night.
 */
class Throttled extends Error {
	constructor(readonly status: number) {
		super(`La web pidió que esperáramos (respondió ${status}): se vuelve a intentar más tarde`);
	}
}
const THROTTLED = new Set([403, 429, 503]);

/** Its HTTP error, if it is a throttle; any other failure, nothing. */
const throttle = (error: unknown) =>
	error instanceof FetchError && THROTTLED.has(error.status) ? new Throttled(error.status) : null;

/**
 * Reads the site's sitemaps, politely: one at a time, with a pause between them (its robots.txt's
 * Crawl-delay, if it says one longer), and stopping as soon as it asks to. A sitemap whose index
 * says it has not changed since the last time (lastmod) is not asked for: its pages stay. All that
 * was read is saved at the end, in one go, or nothing.
 */
async function readSitemaps(k: Kitchen, siteId: number) {
	const [site] = await k.run((tx) => tx.select().from(recipeSite).where(eq(recipeSite.id, siteId)));
	if (!site) return;
	try {
		const origin = `https://${site.host}`;
		let robots = '';
		try {
			robots = (await fetchPublic(`${origin}/robots.txt`, { headers, maxBytes: 500_000 })).body;
		} catch (error) {
			// No robots.txt is fine; being told to stop is not.
			const stop = throttle(error);
			if (stop) throw stop;
		}
		const delay = Math.min(Math.max((crawlDelay(robots) ?? 0) * 1000, PAUSE_MS), MAX_PAUSE_MS);
		const listed = sitemapsInRobots(robots);
		// Listed in robots.txt: all of them. If not, the first of the usual places that is one.
		const queue: SitemapEntry[] = (
			listed.length ? listed : USUAL_SITEMAPS.map((p) => origin + p)
		).map((url) => ({ url, lastmod: null }));
		const firstOnly = !listed.length;

		const before = new Map(
			(
				await k.run((tx) =>
					tx.select().from(recipeSiteSitemap).where(eq(recipeSiteSitemap.siteId, siteId))
				)
			).map((s) => [s.url, s])
		);
		/** Every sitemap of this reading, asked for or kept as it was. */
		const now = new Map<string, { lastmod: string | null; isIndex: boolean }>();
		/** The pages of the sitemaps asked for, by sitemap. */
		const read = new Map<string, Map<string, string>>();
		let kept = 0;
		let asked = 0;
		let newPages = 0;

		while (queue.length && asked < MAX_SITEMAPS) {
			progress.set(siteId, {
				done: now.size,
				total: now.size + queue.filter((e) => !skipSitemap(e.url)).length,
				pages: newPages
			});
			const entry = queue.shift()!;
			if (now.has(entry.url) || skipSitemap(entry.url)) continue;
			const last = before.get(entry.url);
			if (last && !last.isIndex && entry.lastmod && last.lastmod === entry.lastmod) {
				now.set(entry.url, { lastmod: entry.lastmod, isIndex: false });
				kept++;
				continue;
			}
			if (asked) await sleep(delay);
			asked++;
			let parsed;
			try {
				const res = await fetchPublic(entry.url, {
					headers,
					maxBytes: MAX_SITEMAP_BYTES,
					timeoutMs: 60_000
				});
				parsed = parseSitemap(res.body);
			} catch (error) {
				const stop = throttle(error);
				if (stop) throw stop;
				continue;
			}
			if (!parsed) continue;
			const isIndex = parsed.sitemaps.length > 0;
			now.set(entry.url, { lastmod: entry.lastmod, isIndex });
			queue.push(...parsed.sitemaps);
			const pages = new Map<string, string>();
			for (const page of parsed.pages) {
				if (newPages >= MAX_PAGES) break;
				let url: URL;
				try {
					url = new URL(page);
				} catch {
					continue;
				}
				// Only the site's own pages: a sitemap may list others.
				if (!(hostOf(url) === site.host || url.hostname.endsWith(`.${site.host}`))) continue;
				const title = slugTitle(page);
				if (title && !pages.has(url.href)) {
					pages.set(url.href, title);
					newPages++;
				}
			}
			if (!isIndex) read.set(entry.url, pages);
			if (firstOnly && (parsed.pages.length || isIndex)) queue.length = 0;
		}
		// Not reached (too many for one reading): as they were, until the next one.
		for (const entry of queue) {
			const last = before.get(entry.url);
			if (last && !now.has(entry.url)) {
				now.set(entry.url, { lastmod: last.lastmod, isIndex: last.isIndex });
				if (!last.isIndex) kept++;
			}
		}
		if (!read.size && !kept)
			throw new Error(
				asked ? 'Su mapa no tiene recetas que se puedan buscar' : 'No tiene mapa del sitio'
			);

		// The pages of what was read again, of what is gone, and of before this was kept (''): out.
		const replaced = [...read.keys(), ...[...before.keys()].filter((url) => !now.has(url)), ''];
		const rows = [...read].flatMap(([sitemap, pages]) =>
			[...pages].map(([url, title]) => ({
				familyId: k.familyId,
				siteId,
				url,
				sitemap,
				title,
				words: ` ${fold(title)} `
			}))
		);
		await k.run(async (tx) => {
			for (let i = 0; i < replaced.length; i += 500)
				await tx
					.delete(recipeSitePage)
					.where(
						and(
							eq(recipeSitePage.siteId, siteId),
							inArray(recipeSitePage.sitemap, replaced.slice(i, i + 500))
						)
					);
			for (let i = 0; i < rows.length; i += 1000)
				await tx
					.insert(recipeSitePage)
					.values(rows.slice(i, i + 1000))
					.onConflictDoNothing();
			await tx.delete(recipeSiteSitemap).where(eq(recipeSiteSitemap.siteId, siteId));
			const sitemaps = [...now].map(([url, s]) => ({ familyId: k.familyId, siteId, url, ...s }));
			for (let i = 0; i < sitemaps.length; i += 1000)
				await tx.insert(recipeSiteSitemap).values(sitemaps.slice(i, i + 1000));
			const [{ n }] = await tx
				.select({ n: sql<number>`count(*)::int` })
				.from(recipeSitePage)
				.where(eq(recipeSitePage.siteId, siteId));
			await tx
				.update(recipeSite)
				.set({ pages: n, indexedAt: new Date(), lastError: null })
				.where(eq(recipeSite.id, siteId));
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await k.run((tx) =>
			tx
				.update(recipeSite)
				// Told to stop: indexedAt as it was, so that the next time tries again.
				.set(
					error instanceof Throttled
						? { lastError: message }
						: { indexedAt: new Date(), lastError: message }
				)
				.where(eq(recipeSite.id, siteId))
		);
		console.warn(`[recetas] No se pudo leer el mapa de ${site.name}: ${message}`);
	}
}

/** The family's read more than a week ago (or never), one after the other, in the background. */
export function refreshStale(k: Kitchen) {
	void (async () => {
		const stale = await k.run((tx) =>
			tx
				.select({ id: recipeSite.id })
				.from(recipeSite)
				.where(
					or(
						isNull(recipeSite.indexedAt),
						lt(recipeSite.indexedAt, new Date(Date.now() - REFRESH_DAYS * 86_400_000))
					)
				)
		);
		for (const { id } of stale) if (!indexing.has(id)) await indexSite(k, id);
	})().catch((error) => console.warn('[recetas] No se pudieron releer las webs', error));
}

export async function listRecipeSites(k: Kitchen) {
	const sites = await k.run((tx) => tx.select().from(recipeSite).orderBy(asc(recipeSite.name)));
	return sites.map((s) => ({
		...s,
		indexing: isIndexing(s.id),
		progress: progress.get(s.id) ?? null
	}));
}

/** As the family calls it: the site's own name can be long («Recetas de cocina… Directo al Paladar»). */
export async function renameRecipeSite(k: Kitchen, siteId: number, name: string) {
	await k.run((tx) => tx.update(recipeSite).set({ name }).where(eq(recipeSite.id, siteId)));
}

export async function removeRecipeSite(k: Kitchen, siteId: number) {
	await k.run((tx) => tx.delete(recipeSite).where(eq(recipeSite.id, siteId)));
}

/**
 * Pages of the favourite sites (or of one) by the words of `query` in their address: a point for
 * each, and at least half of them, so that «macarrones gratinados con magra picada de cerdo» finds
 * «Macarrones gratinados con picadillo de matanza y carne picada». The most points first; then
 * those that say «receta» (a site's articles are in its maps too), then the shortest, which say
 * less besides.
 */
export async function searchRecipeSites(k: Kitchen, query: string, siteId?: number, limit = 8) {
	const words = searchWords(query);
	if (!words.length) return [];
	// Each word at the start of one: «pan» is not «empanada».
	const has = (w: string) => ilike(recipeSitePage.words, `% ${w}%`);
	const points = sql<number>`(${sql.join(
		words.map((w) => sql`(${has(w)})::int`),
		sql` + `
	)})`;
	return k.run((tx) =>
		tx
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
					or(...words.map(has)),
					sql`${points} >= ${Math.ceil(words.length / 2)}`
				)
			)
			.orderBy(
				sql`${points} desc`,
				sql`${recipeSitePage.words} not like '% receta%'`,
				sql`length(${recipeSitePage.words})`,
				asc(recipeSitePage.title)
			)
			.limit(limit)
	);
}

/** Whether a page is one of a favourite site's: only those are imported by voice. */
export async function isFavouritePage(k: Kitchen, url: string) {
	const [found] = await k.run((tx) =>
		tx
			.select({ id: recipeSitePage.id })
			.from(recipeSitePage)
			.where(eq(recipeSitePage.url, url))
			.limit(1)
	);
	return Boolean(found);
}
