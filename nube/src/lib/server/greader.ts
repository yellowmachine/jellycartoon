import { eq } from 'drizzle-orm';
import { MAX_NEWS, type NewsCard, type NewsGroup, type NewsItem } from '#lib/news.ts';
import { newsLink } from './db/user.schema.ts';
import type { AnyDb } from './family-scope.ts';
import { isWebUrl, plainText } from './podcasts/feed.ts';
import { FetchError, fetchPublic } from './public-fetch.ts';

/**
 * Noticias (#428, #638): the unread entries of a person's news reader, to go to each one's web,
 * through the Google Reader API that Miniflux, FreshRSS and others serve. Only what both Miniflux
 * and FreshRSS answer (tried against both): Miniflux has no `stream/contents` nor `unread-count`,
 * so the unread ids of everything (`stream/items/ids`), then their entries
 * (`stream/items/contents`), grouped here by their folder. Asked from the server, as a browser
 * could not (CORS), and kept a while for each person.
 * https://freshrss.github.io/FreshRSS/en/developers/06_GoogleReader_API.html
 * https://miniflux.app/docs/google_reader.html
 */

export { MAX_NEWS };
/** The newest unread ids asked for: those of every folder, grouped here. */
export const MAX_IDS = 150;
/** Entries asked for at once: each comes with its whole article. */
const CHUNK = 50;
/** Kept this long, for each person: unread entries change every few minutes, the card need not. */
const KEEP_MS = 15 * 60_000;
/** A failed one, asked again after this. */
const FAILED_MS = 2 * 60_000;
const MAX_BYTES = 8_000_000;
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Seilide/1.0 (+https://seilide.app)';
/** The name of their login token among their secrets. */
const KEY_NAME = 'greader';
/** Of before #638, Miniflux's own API key: forgotten when they connect again or remove it. */
const OLD_KEY_NAME = 'miniflux';

const READ = 'user/-/state/com.google/read';
const READING_LIST = 'user/-/state/com.google/reading-list';
/** FreshRSS's, where it serves the API. */
const FRESHRSS_API = '/api/greader.php';

/** The address as written, tidy; null if it is not an `https://` one with nothing else on it. */
export function readerUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
		return null;
	return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/** Its web, to open it from the card: FreshRSS's, without where its API is. */
export const readerWeb = (url: string) =>
	url.endsWith(FRESHRSS_API) ? url.slice(0, -FRESHRSS_API.length) || '/' : url;

/** A folder's name from its stream id: `user/-/label/Deportes`, or with the user's number. */
const labelOf = (id: unknown) =>
	typeof id === 'string' ? (id.match(/^user\/[^/]+\/label\/(.+)$/)?.[1] ?? null) : null;

/** An entry's id as both give it (`tag:google.com,2005:reader/item/…`), or a decimal one. */
export const isItemId = (id: unknown): id is string =>
	typeof id === 'string' &&
	/^(tag:google\.com,2005:reader\/item\/[0-9a-f]{1,16}|\d{1,20})$/.test(id);

/** What `tag/list` answers: their folders, in the reader's order. */
export function parseFolders(body: string): string[] {
	const tags = (JSON.parse(body) as { tags?: unknown }).tags;
	if (!Array.isArray(tags)) throw new Error('No es una respuesta de la API de Google Reader');
	return tags.flatMap((t: Record<string, unknown>) => {
		const name = t?.type === 'folder' ? labelOf(t.id) : null;
		return name ? [name] : [];
	});
}

/** What `unread-count` answers (FreshRSS; Miniflux, `[]`): unread by folder. */
export function parseUnread(body: string): Map<string, number> {
	const counts = (JSON.parse(body) as { unreadcounts?: unknown }).unreadcounts;
	const found = new Map<string, number>();
	if (!Array.isArray(counts)) return found;
	for (const c of counts as Record<string, unknown>[]) {
		const name = labelOf(c?.id);
		if (name && typeof c.count === 'number') found.set(name, c.count);
	}
	return found;
}

/** What `stream/items/ids` answers: the ids, newest first. */
export function parseIds(body: string): string[] {
	const refs = (JSON.parse(body) as { itemRefs?: unknown }).itemRefs;
	if (refs === undefined || refs === null) return [];
	if (!Array.isArray(refs)) throw new Error('No es una respuesta de la API de Google Reader');
	return refs.flatMap((r: Record<string, unknown>) => (isItemId(r?.id) ? [r.id] : []));
}

/** The first web link of a list of them (`canonical`, `alternate`). */
const href = (list: unknown) => {
	if (!Array.isArray(list)) return null;
	const found = (list as { href?: unknown }[])
		.map((l) => (typeof l?.href === 'string' ? l.href : null))
		.find((h) => isWebUrl(h));
	return found ?? null;
};

/** What `stream/items/contents` answers: those with a title and a web link, never the article. */
export function parseItems(body: string): NewsItem[] {
	const items = (JSON.parse(body) as { items?: unknown }).items;
	if (!Array.isArray(items)) throw new Error('No es una respuesta de la API de Google Reader');
	return items.flatMap((e: Record<string, unknown>) => {
		const title = typeof e.title === 'string' ? plainText(e.title)?.replace(/\s+/g, ' ') : null;
		const url = href(e.canonical) ?? href(e.alternate);
		if (!isItemId(e.id) || !title || typeof url !== 'string') return [];
		const at = new Date(typeof e.published === 'number' ? e.published * 1000 : NaN);
		const source = (e.origin as { title?: unknown } | null | undefined)?.title;
		const group = (Array.isArray(e.categories) ? e.categories : []).map(labelOf).find(Boolean);
		return [
			{
				id: e.id,
				title,
				url,
				at: Number.isNaN(at.getTime()) ? null : at.toISOString(),
				source: typeof source === 'string' && source ? source : null,
				group: group ?? null
			}
		];
	});
}

/** Newest first; those with no date, last. */
const newest = (a: NewsItem, b: NewsItem) => (b.at ?? '').localeCompare(a.at ?? '');

/**
 * The card from what was read: the newest of each folder, so that one writing a lot does not hide
 * the others; the folders in the reader's order, with their unread (counted here if it does not
 * say them).
 */
export function cardOf(
	url: string,
	items: NewsItem[],
	folders: string[],
	unread: Map<string, number>
): NewsCard {
	const byGroup = new Map<string | null, NewsItem[]>();
	for (const i of [...items].sort(newest)) {
		const list = byGroup.get(i.group) ?? [];
		list.push(i);
		byGroup.set(i.group, list);
	}
	const groups: NewsGroup[] = folders.flatMap((id) => {
		const list = byGroup.get(id);
		return list ? [{ id, title: id, unread: Math.max(unread.get(id) ?? 0, list.length) }] : [];
	});
	return {
		url: readerWeb(url),
		items: [...byGroup.values()].flatMap((list) => list.slice(0, MAX_NEWS)).sort(newest),
		groups,
		problem: null
	};
}

/** A request with their token: never followed to another address (fetchPublic). */
const ask = (
	url: string,
	auth: string | null,
	path: string,
	form: [string, string][] | null = null
) =>
	fetchPublic(`${url}${path}`, {
		method: form ? 'POST' : 'GET',
		body: form ? new URLSearchParams(form).toString() : undefined,
		headers: {
			...(auth ? { authorization: `GoogleLogin auth=${auth}` } : {}),
			accept: 'application/json, text/plain',
			'user-agent': USER_AGENT,
			...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
		},
		timeoutMs: TIMEOUT_MS,
		maxBytes: MAX_BYTES,
		redirects: false
	});

const refused = (err: unknown) =>
	err instanceof FetchError && (err.status === 401 || err.status === 403);

const NOT_A_READER = 'Esa dirección no tiene la API de Google Reader';

/**
 * Logged in with their user and API password (ClientLogin): the address that answered and its
 * token, or why not, in Spanish. A FreshRSS's own address is tried with its `/api/greader.php` too.
 */
export async function login(
	address: string,
	username: string,
	password: string
): Promise<{ url: string; auth: string } | { problem: string }> {
	const tries = address.endsWith(FRESHRSS_API) ? [address] : [address, `${address}${FRESHRSS_API}`];
	let problem = NOT_A_READER;
	for (const url of tries) {
		try {
			const { body } = await ask(url, null, '/accounts/ClientLogin', [
				['Email', username],
				['Passwd', password]
			]);
			const auth = body.match(/^Auth=(\S+)$/m)?.[1];
			if (!auth) continue;
			// Theirs, and the API's: the folders as it gives them.
			parseFolders((await ask(url, auth, '/reader/api/0/tag/list?output=json')).body);
			return { url, auth };
		} catch (err) {
			if (refused(err)) return { problem: 'No acepta ese usuario o esa contraseña de API' };
			if (err instanceof FetchError || err instanceof SyntaxError) continue;
			problem = err instanceof Error ? err.message : String(err);
		}
	}
	return { problem };
}

export interface ReaderDeps {
	asUser: <T>(userId: string, fn: (tx: AnyDb) => Promise<T>) => Promise<T>;
	secrets: {
		get: (userId: string, name: string) => Promise<string | null>;
		set: (userId: string, name: string, text: string | null) => Promise<void>;
	};
}

export function readerNews({ asUser, secrets }: ReaderDeps) {
	const kept = new Map<string, { card: NewsCard; until: number }>();
	const asking = new Map<string, Promise<NewsCard>>();

	async function linkOf(userId: string) {
		const [row] = await asUser(userId, (tx) =>
			tx
				.select({ url: newsLink.url, username: newsLink.username })
				.from(newsLink)
				.where(eq(newsLink.userId, userId))
		);
		return row ?? null;
	}

	/** Its token for what changes something (Miniflux asks for it on every POST). */
	const tokenOf = async (url: string, auth: string) =>
		(await ask(url, auth, '/reader/api/0/token')).body.trim();

	/** The card, and for how long. A failure keeps what there was, a little longer. */
	async function read(userId: string, url: string, before: NewsCard | undefined) {
		const auth = await secrets.get(userId, KEY_NAME);
		const none = { url: readerWeb(url), items: [], groups: [] };
		if (!auth) return { card: { ...none, problem: 'key' as const }, keep: FAILED_MS };
		try {
			const [folders, unread, ids, token] = await Promise.all([
				ask(url, auth, '/reader/api/0/tag/list?output=json').then((r) => parseFolders(r.body)),
				ask(url, auth, '/reader/api/0/unread-count?output=json')
					.then((r) => parseUnread(r.body))
					.catch((err) => {
						if (refused(err)) throw err;
						return new Map<string, number>();
					}),
				ask(
					url,
					auth,
					`/reader/api/0/stream/items/ids?${new URLSearchParams({
						output: 'json',
						s: READING_LIST,
						xt: READ,
						n: String(MAX_IDS)
					})}`
				).then((r) => parseIds(r.body)),
				tokenOf(url, auth)
			]);
			const chunks = Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, n) =>
				ids.slice(n * CHUNK, (n + 1) * CHUNK)
			);
			const items = (
				await Promise.all(
					chunks.map(async (chunk) =>
						parseItems(
							(
								await ask(url, auth, '/reader/api/0/stream/items/contents?output=json', [
									['T', token],
									...chunk.map((i): [string, string] => ['i', i])
								])
							).body
						)
					)
				)
			).flat();
			return { card: cardOf(url, items, folders, unread), keep: KEEP_MS };
		} catch (err) {
			if (refused(err)) return { card: { ...none, problem: 'key' as const }, keep: FAILED_MS };
			console.warn('[noticias] Sin noticias del lector', String(err));
			const items = before?.items ?? [];
			return {
				card: {
					...none,
					items,
					groups: before?.groups ?? [],
					problem: items.length ? null : ('down' as const)
				},
				keep: FAILED_MS
			};
		}
	}

	return {
		/** Their address and user, for Ajustes. */
		linkOf,

		/** Their card; null if they have no reader. */
		async newsOf(userId: string, now = Date.now()): Promise<NewsCard | null> {
			const hit = kept.get(userId);
			if (hit && hit.until > now) return hit.card;
			const link = await linkOf(userId);
			if (!link) return null;
			let pending = asking.get(userId);
			if (!pending) {
				pending = read(userId, link.url, hit?.card).then(({ card, keep }) => {
					kept.set(userId, { card, until: Date.now() + keep });
					return card;
				});
				asking.set(userId, pending);
				pending.finally(() => asking.delete(userId)).catch(() => {});
			}
			return pending;
		},

		/**
		 * Their address and user, once the reader has let them in; its token kept, not the password.
		 * Why not, in Spanish, if not.
		 */
		async save(userId: string, address: string, username: string, password: string) {
			const url = readerUrl(address);
			if (!url) return 'Escribe la dirección completa, que empiece por https://';
			if (!username) return 'Escribe tu usuario';
			if (!password) return 'Escribe la contraseña de API';
			const done = await login(url, username, password);
			if ('problem' in done) return done.problem;
			await secrets.set(userId, KEY_NAME, done.auth);
			await secrets.set(userId, OLD_KEY_NAME, null);
			await asUser(userId, (tx) =>
				tx
					.insert(newsLink)
					.values({ userId, url: done.url, username })
					.onConflictDoUpdate({
						target: newsLink.userId,
						set: { url: done.url, username, updatedAt: new Date() }
					})
			);
			kept.delete(userId);
			return null;
		},

		/** Forgotten: their address and token. In the reader, the password goes on until changed. */
		async remove(userId: string) {
			await secrets.set(userId, KEY_NAME, null);
			await secrets.set(userId, OLD_KEY_NAME, null);
			await asUser(userId, (tx) => tx.delete(newsLink).where(eq(newsLink.userId, userId)));
			kept.delete(userId);
		},

		/** Off the card at once; in the reader, as read. If that fails, it comes back later: in the log. */
		async markRead(userId: string, id: string) {
			const hit = kept.get(userId);
			const item = hit?.card.items.find((i) => i.id === id);
			if (hit && item)
				kept.set(userId, {
					...hit,
					card: {
						...hit.card,
						items: hit.card.items.filter((i) => i.id !== id),
						groups: hit.card.groups.map((g) =>
							g.id === item.group ? { ...g, unread: Math.max(0, g.unread - 1) } : g
						)
					}
				});
			const [link, auth] = await Promise.all([linkOf(userId), secrets.get(userId, KEY_NAME)]);
			if (!link || !auth) return;
			try {
				const token = await tokenOf(link.url, auth);
				await ask(link.url, auth, '/reader/api/0/edit-tag', [
					['i', id],
					['a', READ],
					['T', token]
				]);
			} catch (err) {
				console.warn('[noticias] No se pudo marcar como leída', String(err));
			}
		}
	};
}
