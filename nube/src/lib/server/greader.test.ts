import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { newsLink, user } from './db/schema.ts';
import { userScope } from './family-scope.ts';
import {
	isItemId,
	MAX_IDS,
	MAX_NEWS,
	parseFolders,
	parseIds,
	parseItems,
	parseUnread,
	readerNews,
	readerUrl,
	readerWeb
} from './greader.ts';
import { newsShown, newsUnread } from '#lib/news.ts';

/**
 * With the real tables and RLS, and a fake reader at a public address (fetchPublic asks no DNS).
 * The answers are shaped as Miniflux 2 and FreshRSS 1.31 gave them on 2026-11-26.
 */
const db = drizzle(new PGlite(), { schema });
const asUser = userScope(db, { role: 'app_user' });
const HOME = 'https://93.184.216.34';

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.insert(user).values(
		['ana', 'bea', 'cris', 'dani', 'eva', 'fran', 'gema'].map((id) => ({
			id,
			name: id,
			email: `${id}@example.org`,
			createdAt: new Date(),
			updatedAt: new Date()
		}))
	);
});

type Answer = (url: URL, init: RequestInit) => Response | undefined;
const realFetch = globalThis.fetch;
const asked: { url: URL; init: RequestInit }[] = [];
function reader(answer: Answer) {
	asked.length = 0;
	globalThis.fetch = (async (url: URL, init: RequestInit) => {
		asked.push({ url, init });
		return answer(url, init) ?? new Response('Not found', { status: 404 });
	}) as unknown as typeof fetch;
}
afterEach(() => {
	globalThis.fetch = realFetch;
});

const AUTH = 'lector/89b18ed53e6546bb';
const hex = (n: number) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;
/** An entry as `stream/items/contents` gives it (Miniflux: `user/1/…`). */
const item = (n: number, title = `Noticia ${n}`, folder: string | null = 'Deportes') => ({
	id: hex(n),
	categories: [
		'user/1/state/com.google/reading-list',
		...(folder ? [`user/1/label/${folder}`] : [])
	],
	title,
	published: Date.UTC(2026, 10, 20, 9, 0, n) / 1000,
	alternate: [{ href: `https://periodico.example/${n}`, type: 'text/html' }],
	canonical: [{ href: `https://periodico.example/${n}` }],
	origin: { streamId: 'feed/1', title: 'El Periódico', htmlUrl: 'https://periodico.example' },
	summary: { direction: 'ltr', content: '<p>artículo entero</p>' }
});
type Item = ReturnType<typeof item>;

/**
 * A Miniflux with these folders and unread entries: newest first, no unread-count (`[]`), the
 * token asked for on every POST. With `counts`, FreshRSS's unread-count instead.
 */
const serving =
	(list: Item[], folders = ['Deportes'], counts: Record<string, number> | null = null): Answer =>
	(url, init) => {
		const path = url.pathname;
		const auth = (init.headers as Record<string, string>).authorization;
		if (path === '/accounts/ClientLogin')
			return new Response(`SID=${AUTH}\nLSID=${AUTH}\nAuth=${AUTH}\n`);
		if (auth !== `GoogleLogin auth=${AUTH}`) return new Response('Unauthorized', { status: 401 });
		if (path === '/reader/api/0/token') return new Response(AUTH);
		if (path === '/reader/api/0/tag/list')
			return Response.json({
				tags: [
					{ id: 'user/1/state/com.google/starred' },
					...folders.map((f) => ({ id: `user/1/label/${f}`, label: f, type: 'folder' }))
				]
			});
		if (path === '/reader/api/0/unread-count')
			return Response.json(
				counts
					? {
							max: 0,
							unreadcounts: Object.entries(counts).map(([f, count]) => ({
								id: `user/-/label/${f}`,
								count,
								newestItemTimestampUsec: '0'
							}))
						}
					: []
			);
		if (path === '/reader/api/0/stream/items/ids')
			return Response.json({
				itemRefs: [...list]
					.sort((a, b) => b.published - a.published)
					.slice(0, Number(url.searchParams.get('n')))
					.map((i) => ({ id: String(parseInt(i.id.split('/').pop()!, 16)) }))
			});
		const form = new URLSearchParams(String(init.body ?? ''));
		if (init.method === 'POST' && form.get('T') !== AUTH)
			return new Response('Unauthorized', { status: 401 });
		if (path === '/reader/api/0/stream/items/contents') {
			const ids = form.getAll('i').map(Number);
			return Response.json({
				id: 'user/-/state/com.google/reading-list',
				items: list.filter((i) => ids.includes(parseInt(i.id.split('/').pop()!, 16)))
			});
		}
		if (path === '/reader/api/0/edit-tag') return new Response('OK');
	};

/** Kept in memory: enough here, user-secret.test.ts has the real ones. */
function deps() {
	const kept = new Map<string, string>();
	return {
		kept,
		deps: {
			asUser,
			secrets: {
				get: async (u: string, n: string) => kept.get(`${u}/${n}`) ?? null,
				set: async (u: string, n: string, text: string | null) => {
					if (text === null) kept.delete(`${u}/${n}`);
					else kept.set(`${u}/${n}`, text);
				}
			}
		}
	};
}

describe('addresses', () => {
	test('tidy, only https, nothing else on it', () => {
		expect(readerUrl(' https://news.example.org/ ')).toBe('https://news.example.org');
		expect(readerUrl('https://example.org/miniflux/')).toBe('https://example.org/miniflux');
		expect(readerUrl('http://news.example.org')).toBeNull();
		expect(readerUrl('https://yo:clave@news.example.org')).toBeNull();
		expect(readerUrl('https://news.example.org/?a=1')).toBeNull();
		expect(readerUrl('news.example.org')).toBeNull();
	});

	test('its web: FreshRSS’s without where its API is', () => {
		expect(readerWeb('https://rss.example.org/api/greader.php')).toBe('https://rss.example.org');
		expect(readerWeb('https://example.org/rss/api/greader.php')).toBe('https://example.org/rss');
		expect(readerWeb('https://miniflux.example.org')).toBe('https://miniflux.example.org');
	});

	test('an entry’s id, long or decimal; nothing else', () => {
		expect(isItemId(hex(10))).toBe(true);
		expect(isItemId('1795697963755610')).toBe(true);
		expect(isItemId(10)).toBe(false);
		expect(isItemId('tag:google.com,2005:reader/item/zz')).toBe(false);
		expect(isItemId('../edit-tag')).toBe(false);
	});
});

describe('what the API answers', () => {
	test('folders, with Miniflux’s user number or FreshRSS’s «-»; not the states', () => {
		expect(
			parseFolders(
				JSON.stringify({
					tags: [
						{ id: 'user/-/state/com.google/starred' },
						{ id: 'user/-/label/Deportes', type: 'folder' },
						{ id: 'user/1/label/Mundo y más', label: 'Mundo y más', type: 'folder' },
						{ id: 'user/-/label/Leer luego', type: 'tag', unread_count: 2 }
					]
				})
			)
		).toEqual(['Deportes', 'Mundo y más']);
		expect(() => parseFolders('[]')).toThrow();
	});

	test('unread by folder from FreshRSS; Miniflux’s `[]`, none', () => {
		const counts = parseUnread(
			JSON.stringify({
				max: 10,
				unreadcounts: [
					{ id: 'feed/1', count: 10, newestItemTimestampUsec: '1' },
					{ id: 'user/-/label/Deportes', count: 7, newestItemTimestampUsec: '1' },
					{ id: 'user/-/state/com.google/reading-list', count: 10, newestItemTimestampUsec: '1' }
				]
			})
		);
		expect([...counts]).toEqual([['Deportes', 7]]);
		expect(parseUnread('[]').size).toBe(0);
	});

	test('ids; none unread, none', () => {
		expect(
			parseIds(JSON.stringify({ itemRefs: [{ id: '6' }, { id: 'x' }], continuation: '4' }))
		).toEqual(['6']);
		expect(parseIds('{}')).toEqual([]);
	});

	test('only what the card shows: never the article; a title as text; web links only', () => {
		const items = parseItems(
			JSON.stringify({
				items: [
					item(1, '<b>Con</b>  etiquetas'),
					{ ...item(2), canonical: [{ href: 'javascript:alert(1)' }], alternate: [] },
					{ ...item(3), title: '' },
					item(4, 'Sin carpeta', null)
				]
			})
		);
		expect(JSON.stringify(items)).not.toContain('artículo');
		expect(items).toEqual([
			{
				id: hex(1),
				title: 'Con etiquetas',
				url: 'https://periodico.example/1',
				at: '2026-11-20T09:00:01.000Z',
				source: 'El Periódico',
				group: 'Deportes'
			},
			{
				id: hex(4),
				title: 'Sin carpeta',
				url: 'https://periodico.example/4',
				at: '2026-11-20T09:00:04.000Z',
				source: 'El Periódico',
				group: null
			}
		]);
		expect(() => parseItems('[]')).toThrow();
	});
});

describe('save', () => {
	test('kept once it lets them in: its token, never the password', async () => {
		const { deps: d, kept } = deps();
		const news = readerNews(d);
		kept.set('ana/miniflux', 'la-clave-de-antes');
		reader(serving([]));
		expect(await news.save('ana', `${HOME}/`, 'lector', 'secreta')).toBeNull();
		expect(asked[0]!.url.href).toBe(`${HOME}/accounts/ClientLogin`);
		expect(asked[0]!.init.method).toBe('POST');
		expect(Object.fromEntries(new URLSearchParams(String(asked[0]!.init.body)))).toEqual({
			Email: 'lector',
			Passwd: 'secreta'
		});
		expect(kept.get('ana/greader')).toBe(AUTH);
		expect([...kept.values()]).not.toContain('secreta');
		expect(kept.has('ana/miniflux')).toBe(false);
		expect(await news.linkOf('ana')).toEqual({ url: HOME, username: 'lector' });
	});

	test('a FreshRSS by its own address: found at /api/greader.php', async () => {
		const { deps: d } = deps();
		const news = readerNews(d);
		const api = serving([]);
		reader((url, init) => {
			if (!url.pathname.startsWith('/api/greader.php'))
				return new Response('<html>FreshRSS</html>');
			return api(new URL(url.href.replace('/api/greader.php', '')), init);
		});
		expect(await news.save('gema', HOME, 'lector', 'secreta')).toBeNull();
		expect(await news.linkOf('gema')).toEqual({
			url: `${HOME}/api/greader.php`,
			username: 'lector'
		});
	});

	test('nothing kept with a refused password, another site, a redirect or http', async () => {
		const { deps: d, kept } = deps();
		const news = readerNews(d);
		reader(() => new Response('Unauthorized', { status: 401 }));
		expect(await news.save('bea', HOME, 'lector', 'mala')).toBe(
			'No acepta ese usuario o esa contraseña de API'
		);
		reader(() => new Response('<html>hola</html>'));
		expect(await news.save('bea', HOME, 'lector', 'k')).toBe(
			'Esa dirección no tiene la API de Google Reader'
		);
		reader(() => new Response('', { status: 302, headers: { location: 'https://1.1.1.1/' } }));
		expect(await news.save('bea', HOME, 'lector', 'k')).toBe('Esa dirección redirige a otra');
		reader(serving([]));
		expect(await news.save('bea', 'http://93.184.216.34', 'lector', 'k')).toContain('https://');
		expect(await news.save('bea', HOME, '', 'k')).toBe('Escribe tu usuario');
		expect(await news.save('bea', 'https://127.0.0.1', 'lector', 'k')).toContain(
			'no es de internet'
		);
		expect(asked).toHaveLength(0);
		expect(kept.size).toBe(0);
		expect(await news.linkOf('bea')).toBeNull();
	});
});

describe('the card', () => {
	test('none without a reader; unread, newest first, at most the card’s', async () => {
		const { deps: d } = deps();
		const news = readerNews(d);
		expect(await news.newsOf('cris')).toBeNull();
		reader(serving(Array.from({ length: 12 }, (_, i) => item(i + 1))));
		await news.save('cris', HOME, 'lector', 'k');
		asked.length = 0;
		const card = await news.newsOf('cris');
		expect(card?.items).toHaveLength(MAX_NEWS);
		expect(card?.items[0]!.id).toBe(hex(12));
		expect(card?.groups).toEqual([{ id: 'Deportes', title: 'Deportes', unread: 12 }]);
		expect(card?.problem).toBeNull();
		const ids = asked.find((a) => a.url.pathname === '/reader/api/0/stream/items/ids')!;
		expect(Object.fromEntries(ids.url.searchParams)).toEqual({
			output: 'json',
			s: 'user/-/state/com.google/reading-list',
			xt: 'user/-/state/com.google/read',
			n: String(MAX_IDS)
		});
	});

	test('the newest of each folder: one writing a lot does not hide the others', async () => {
		const { deps: d } = deps();
		const news = readerNews(d);
		const busy = Array.from({ length: 20 }, (_, i) => item(100 + i, undefined, 'Deportes'));
		const quiet = [item(1, 'Poco', 'Mundo y más'), item(2, 'Más', 'Mundo y más')];
		reader(
			serving([...busy, ...quiet, item(3, 'Suelta', null)], ['Deportes', 'Mundo y más', 'Vacía'])
		);
		await news.save('dani', HOME, 'lector', 'k');
		const card = (await news.newsOf('dani'))!;
		// Miniflux says no unread counts: those read here.
		expect(card.groups.map((g) => [g.id, g.unread])).toEqual([
			['Deportes', 20],
			['Mundo y más', 2]
		]);
		expect(newsShown(card, 'Mundo y más').map((i) => i.title)).toEqual(['Más', 'Poco']);
		expect(newsShown(card, 'Deportes')).toHaveLength(MAX_NEWS);
		expect(newsShown(card, null)).toHaveLength(MAX_NEWS);
		expect(card.items.some((i) => i.title === 'Suelta')).toBe(true);
		// A folder no longer there: «Todas».
		expect(newsShown(card, 'Vieja')).toEqual(newsShown(card, null));
	});

	test('FreshRSS’s unread counts, more than those read here', async () => {
		const { deps: d } = deps();
		const news = readerNews(d);
		reader(serving([item(1), item(2)], ['Deportes'], { Deportes: 40 }));
		await news.save('eva', HOME, 'lector', 'k');
		const card = (await news.newsOf('eva'))!;
		expect(card.groups[0]!.unread).toBe(40);
		expect(newsUnread(card, card.groups[0]!, [hex(1)])).toBe(39);
	});

	test('kept a while for each person; a failure keeps what there was; a refused token, to change', async () => {
		const { deps: d, kept } = deps();
		const news = readerNews(d);
		reader(serving([item(1)]));
		await news.save('fran', HOME, 'lector', 'k');
		await news.newsOf('fran');
		const asks = asked.length;
		await news.newsOf('fran');
		expect(asked).toHaveLength(asks);
		expect(await news.newsOf('bea')).toBeNull();

		reader(() => new Response('', { status: 500 }));
		const failed = await news.newsOf('fran', Date.now() + 16 * 60_000);
		expect(failed?.items).toHaveLength(1);
		expect(failed?.problem).toBeNull();

		kept.set('fran/greader', 'otro');
		reader(serving([item(1)]));
		const refused = await news.newsOf('fran', Date.now() + 32 * 60_000);
		expect(refused?.problem).toBe('key');
		expect(refused?.items).toEqual([]);
	});

	test('marked as read: off what is kept, and told to the reader with its token', async () => {
		const { deps: d } = deps();
		const news = readerNews(d);
		reader(serving([item(1), item(2)]));
		await news.save('gema', HOME, 'lector', 'k');
		await news.newsOf('gema');
		asked.length = 0;
		await news.markRead('gema', hex(1));
		const edit = asked.find((a) => a.url.pathname === '/reader/api/0/edit-tag')!;
		expect(edit.init.method).toBe('POST');
		expect(Object.fromEntries(new URLSearchParams(String(edit.init.body)))).toEqual({
			i: hex(1),
			a: 'user/-/state/com.google/read',
			T: AUTH
		});
		const after = await news.newsOf('gema');
		expect(after?.items.map((i) => i.id)).toEqual([hex(2)]);
		expect(after?.groups[0]!.unread).toBe(1);

		reader(() => new Response('', { status: 500 }));
		await news.markRead('gema', hex(2));
		expect((await news.newsOf('gema'))?.items).toEqual([]);
	});

	test('removed: address and token forgotten, and no card', async () => {
		const { deps: d, kept } = deps();
		const news = readerNews(d);
		reader(serving([item(1)]));
		await news.save('ana', HOME, 'lector', 'k');
		await news.newsOf('ana');
		await news.remove('ana');
		expect(kept.size).toBe(0);
		expect(await news.newsOf('ana')).toBeNull();
	});

	test('one person’s address, invisible to another', async () => {
		const { deps: d } = deps();
		const news = readerNews(d);
		reader(serving([]));
		await news.save('ana', HOME, 'lector', 'k');
		const seen = await asUser('bea', (tx) => tx.select().from(newsLink));
		expect(seen.map((r) => r.userId)).not.toContain('ana');
	});
});
