import { eq } from 'drizzle-orm';
import type { NewsCard, NewsItem } from '#lib/news.ts';
import { minifluxLink } from './db/user.schema.ts';
import type { AnyDb } from './family-scope.ts';
import { isWebUrl, plainText } from './podcasts/feed.ts';
import { FetchError, fetchPublic } from './public-fetch.ts';

/**
 * Noticias (#428): the unread entries of a person's Miniflux, to go to each one's web, through its
 * API (https://miniflux.app/docs/api.html) with an API key of theirs. Asked from the server, as a
 * browser could not (CORS), and kept a while for each person.
 */

/** The newest ones on the card. */
export const MAX_NEWS = 8;
/** Kept this long, for each person: unread entries change every few minutes, the card need not. */
const KEEP_MS = 15 * 60_000;
/** A failed one, asked again after this. */
const FAILED_MS = 2 * 60_000;
/** Each entry comes with its whole article (`content`), which is not kept. */
const MAX_BYTES = 8_000_000;
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Seilide/1.0 (+https://seilide.app)';
/** The name of their API key among their secrets. */
const KEY_NAME = 'miniflux';

/** Their Miniflux's address, tidy; null if it is not an `https://` one with nothing else on it. */
export function minifluxUrl(value: string) {
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

/** What `GET /v1/entries` answers: those with a title and a web link. */
export function parseEntries(body: string): NewsItem[] {
	const entries = (JSON.parse(body) as { entries?: unknown }).entries;
	if (!Array.isArray(entries)) throw new Error('No es una respuesta de Miniflux');
	return entries.flatMap((e: Record<string, unknown>) => {
		const title = typeof e.title === 'string' ? plainText(e.title)?.replace(/\s+/g, ' ') : null;
		const url = typeof e.url === 'string' ? e.url : null;
		if (typeof e.id !== 'number' || !title || !isWebUrl(url)) return [];
		const at = new Date(typeof e.published_at === 'string' ? e.published_at : NaN);
		const source = (e.feed as { title?: unknown } | null | undefined)?.title;
		return [
			{
				id: e.id,
				title,
				url,
				at: Number.isNaN(at.getTime()) ? null : at.toISOString(),
				source: typeof source === 'string' && source ? source : null
			}
		];
	});
}

/** A request with their key: never followed to another address (fetchPublic). */
const ask = (
	url: string,
	key: string,
	path: string,
	options: { method?: string; body?: string } = {}
) =>
	fetchPublic(`${url}${path}`, {
		...options,
		headers: {
			'x-auth-token': key,
			accept: 'application/json',
			'user-agent': USER_AGENT,
			...(options.body ? { 'content-type': 'application/json' } : {})
		},
		timeoutMs: TIMEOUT_MS,
		maxBytes: MAX_BYTES,
		redirects: false
	});

const refused = (err: unknown) =>
	err instanceof FetchError && (err.status === 401 || err.status === 403);

/** Why that address and key do not do, in Spanish; null if they do. */
export async function checkMiniflux(url: string, key: string) {
	try {
		const { body } = await ask(url, key, '/v1/me');
		const me = JSON.parse(body) as { username?: unknown };
		return typeof me.username === 'string' ? null : 'Esa dirección no parece un Miniflux';
	} catch (err) {
		if (refused(err)) return 'Miniflux no acepta esa clave';
		if (err instanceof FetchError) return 'Esa dirección no parece un Miniflux';
		if (err instanceof SyntaxError) return 'Esa dirección no parece un Miniflux';
		return err instanceof Error ? err.message : String(err);
	}
}

export interface MinifluxDeps {
	asUser: <T>(userId: string, fn: (tx: AnyDb) => Promise<T>) => Promise<T>;
	secrets: {
		get: (userId: string, name: string) => Promise<string | null>;
		set: (userId: string, name: string, text: string | null) => Promise<void>;
	};
}

export function minifluxNews({ asUser, secrets }: MinifluxDeps) {
	const kept = new Map<string, { card: NewsCard; until: number }>();
	const asking = new Map<string, Promise<NewsCard>>();

	async function linkOf(userId: string) {
		const [row] = await asUser(userId, (tx) =>
			tx.select({ url: minifluxLink.url }).from(minifluxLink).where(eq(minifluxLink.userId, userId))
		);
		return row?.url ?? null;
	}

	/** The card, and for how long. A failure keeps what there was, a little longer. */
	async function read(userId: string, url: string, before: NewsCard | undefined) {
		const key = await secrets.get(userId, KEY_NAME);
		if (!key) return { card: { url, items: [], problem: 'key' as const }, keep: FAILED_MS };
		try {
			const { body } = await ask(
				url,
				key,
				`/v1/entries?status=unread&order=published_at&direction=desc&limit=${MAX_NEWS}`
			);
			return {
				card: { url, items: parseEntries(body).slice(0, MAX_NEWS), problem: null },
				keep: KEEP_MS
			};
		} catch (err) {
			if (refused(err))
				return { card: { url, items: [], problem: 'key' as const }, keep: FAILED_MS };
			console.warn('[noticias] Sin noticias de Miniflux', String(err));
			const items = before?.items ?? [];
			return {
				card: { url, items, problem: items.length ? null : ('down' as const) },
				keep: FAILED_MS
			};
		}
	}

	return {
		/** Their address, for Ajustes. */
		linkOf,

		/** Their card; null if they have no Miniflux. */
		async newsOf(userId: string, now = Date.now()): Promise<NewsCard | null> {
			const hit = kept.get(userId);
			if (hit && hit.until > now) return hit.card;
			const url = await linkOf(userId);
			if (!url) return null;
			let pending = asking.get(userId);
			if (!pending) {
				pending = read(userId, url, hit?.card).then(({ card, keep }) => {
					kept.set(userId, { card, until: Date.now() + keep });
					return card;
				});
				asking.set(userId, pending);
				pending.finally(() => asking.delete(userId)).catch(() => {});
			}
			return pending;
		},

		/** Their address and key, once Miniflux has accepted them. Why not, in Spanish, if not. */
		async save(userId: string, address: string, key: string) {
			const url = minifluxUrl(address);
			if (!url) return 'Escribe la dirección completa, que empiece por https://';
			if (!key) return 'Escribe la clave de API';
			const problem = await checkMiniflux(url, key);
			if (problem) return problem;
			await secrets.set(userId, KEY_NAME, key);
			await asUser(userId, (tx) =>
				tx
					.insert(minifluxLink)
					.values({ userId, url })
					.onConflictDoUpdate({
						target: minifluxLink.userId,
						set: { url, updatedAt: new Date() }
					})
			);
			kept.delete(userId);
			return null;
		},

		/** Forgotten: their address and key. In Miniflux, the key goes on until deleted there. */
		async remove(userId: string) {
			await secrets.set(userId, KEY_NAME, null);
			await asUser(userId, (tx) => tx.delete(minifluxLink).where(eq(minifluxLink.userId, userId)));
			kept.delete(userId);
		},

		/** Off the card at once; in Miniflux, as read. If that fails, it comes back later: in the log. */
		async markRead(userId: string, id: number) {
			const hit = kept.get(userId);
			if (hit)
				kept.set(userId, {
					...hit,
					card: { ...hit.card, items: hit.card.items.filter((i) => i.id !== id) }
				});
			const [url, key] = await Promise.all([linkOf(userId), secrets.get(userId, KEY_NAME)]);
			if (!url || !key) return;
			await ask(url, key, '/v1/entries', {
				method: 'PUT',
				body: JSON.stringify({ entry_ids: [id], status: 'read' })
			}).catch((err) => console.warn('[noticias] No se pudo marcar como leída', String(err)));
		}
	};
}
