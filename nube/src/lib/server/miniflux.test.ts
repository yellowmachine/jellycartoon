import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { minifluxLink, user } from './db/schema.ts';
import { userScope } from './family-scope.ts';
import { MAX_NEWS, minifluxNews, minifluxUrl, parseEntries, parseGroups } from './miniflux.ts';
import { newsShown, newsUnread } from '#lib/news.ts';

/** With the real tables and RLS, and a fake Miniflux at a public address (fetchPublic asks no DNS). */
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
		['ana', 'bea', 'cris', 'dani', 'eva', 'fran'].map((id) => ({
			id,
			name: id,
			email: `${id}@example.org`,
			createdAt: new Date(),
			updatedAt: new Date()
		}))
	);
});

type Answer = (url: URL, init: RequestInit) => Response;
const realFetch = globalThis.fetch;
const asked: { url: URL; init: RequestInit }[] = [];
function miniflux(answer: Answer) {
	asked.length = 0;
	globalThis.fetch = (async (url: URL, init: RequestInit) => {
		asked.push({ url, init });
		return answer(url, init);
	}) as unknown as typeof fetch;
}
afterEach(() => {
	globalThis.fetch = realFetch;
});

const entry = (id: number, title = `Noticia ${id}`, category = 1) => ({
	id,
	title,
	url: `https://periodico.example/${id}`,
	published_at: new Date(Date.UTC(2026, 10, 6, 9, 0, id)).toISOString(),
	content: '<p>artículo entero</p>',
	feed: { title: 'El Periódico', category: { id: category, user_id: 1, title: `Cat ${category}` } }
});
type Entry = ReturnType<typeof entry>;
const category = (id: number, unread: number, hidden = false) => ({
	id,
	title: `Cat ${id}`,
	user_id: 1,
	hide_globally: hidden,
	feed_count: 2,
	total_unread: unread
});
/** A Miniflux with these categories, each answering its unread entries (all of category 1 if none). */
const entries =
	(list: Entry[], categories = [category(1, list.length)]) =>
	(url: URL) => {
		if (url.pathname === '/v1/categories') return Response.json(categories);
		const id = Number(url.pathname.match(/^\/v1\/categories\/(\d+)\/entries$/)?.[1]);
		// As Miniflux: newest first, at most the limit.
		const mine = list
			.filter((e) => e.feed.category.id === id)
			.sort((x, y) => y.published_at.localeCompare(x.published_at))
			.slice(0, Number(url.searchParams.get('limit')) || undefined);
		return Response.json({ total: mine.length, entries: mine });
	};
const me = () => Response.json({ id: 1, username: 'miguel' });
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

describe('minifluxUrl', () => {
	test('tidy, only https, nothing else on it', () => {
		expect(minifluxUrl(' https://news.example.org/ ')).toBe('https://news.example.org');
		expect(minifluxUrl('https://example.org/miniflux/')).toBe('https://example.org/miniflux');
		expect(minifluxUrl('http://news.example.org')).toBeNull();
		expect(minifluxUrl('https://yo:clave@news.example.org')).toBeNull();
		expect(minifluxUrl('https://news.example.org/?a=1')).toBeNull();
		expect(minifluxUrl('news.example.org')).toBeNull();
	});
});

describe('parseEntries', () => {
	test('only what the card shows: never the article', () => {
		expect(JSON.stringify(parseEntries(JSON.stringify({ entries: [entry(1)] })))).not.toContain(
			'artículo'
		);
		expect(parseEntries(JSON.stringify({ entries: [entry(1)] }))).toEqual([
			{
				id: 1,
				title: 'Noticia 1',
				url: 'https://periodico.example/1',
				at: '2026-11-06T09:00:01.000Z',
				source: 'El Periódico',
				group: 1
			}
		]);
	});

	test('a title as text; a link that is not of the web, left out', () => {
		const items = parseEntries(
			JSON.stringify({
				entries: [
					entry(1, '<b>Con</b>  etiquetas'),
					{ ...entry(2), url: 'javascript:alert(1)' },
					{ ...entry(3), title: '' }
				]
			})
		);
		expect(items.map((i) => [i.id, i.title])).toEqual([[1, 'Con etiquetas']]);
	});

	test('not an answer of Miniflux: an error, not «nothing to read»', () => {
		expect(() => parseEntries('{"error":"no"}')).toThrow();
		expect(() => parseEntries('<html>')).toThrow();
	});
});

describe('save', () => {
	test('kept only once Miniflux accepts it, asked with the key in its header', async () => {
		const { deps: d, kept } = deps();
		const news = minifluxNews(d);
		miniflux(() => me());
		expect(await news.save('ana', `${HOME}/`, ' clave '.trim())).toBeNull();
		expect(asked[0]!.url.href).toBe(`${HOME}/v1/me`);
		expect((asked[0]!.init.headers as Record<string, string>)['x-auth-token']).toBe('clave');
		expect(kept.get('ana/miniflux')).toBe('clave');
		expect(await news.linkOf('ana')).toBe(HOME);
	});

	test('nothing kept with a refused key, another site, a redirect or http', async () => {
		const { deps: d, kept } = deps();
		const news = minifluxNews(d);
		miniflux(() => new Response('', { status: 401 }));
		expect(await news.save('bea', HOME, 'mala')).toBe('Miniflux no acepta esa clave');
		miniflux(() => new Response('<html>hola</html>'));
		expect(await news.save('bea', HOME, 'k')).toBe('Esa dirección no parece un Miniflux');
		miniflux(() => new Response('', { status: 404 }));
		expect(await news.save('bea', HOME, 'k')).toBe('Esa dirección no parece un Miniflux');
		miniflux(() => new Response('', { status: 302, headers: { location: 'https://1.1.1.1/' } }));
		expect(await news.save('bea', HOME, 'k')).toBe('Esa dirección redirige a otra');
		expect(asked).toHaveLength(1);
		miniflux(() => me());
		expect(await news.save('bea', 'http://93.184.216.34', 'k')).toContain('https://');
		expect(await news.save('bea', 'https://127.0.0.1', 'k')).toContain('no es de internet');
		expect(asked).toHaveLength(0);
		expect(kept.size).toBe(0);
		expect(await news.linkOf('bea')).toBeNull();
	});
});

describe('the card', () => {
	test('none without a Miniflux; unread, newest first, at most the card’s', async () => {
		const { deps: d } = deps();
		const news = minifluxNews(d);
		expect(await news.newsOf('cris')).toBeNull();
		miniflux(() => me());
		await news.save('cris', HOME, 'k');
		miniflux(entries(Array.from({ length: 12 }, (_, i) => entry(i + 1))));
		const card = await news.newsOf('cris');
		expect(card?.items).toHaveLength(MAX_NEWS);
		expect(card?.items[0]!.id).toBe(12);
		expect(card?.problem).toBeNull();
		expect(asked[0]!.url.href).toBe(`${HOME}/v1/categories?counts=true`);
		expect(asked[1]!.url.pathname).toBe('/v1/categories/1/entries');
		const asks = asked[1]!.url.searchParams;
		expect(Object.fromEntries(asks)).toEqual({
			status: 'unread',
			order: 'published_at',
			direction: 'desc',
			limit: String(MAX_NEWS)
		});
	});

	test('kept a while for each person: not asked again, not given to another', async () => {
		const { deps: d } = deps();
		const news = minifluxNews(d);
		miniflux(() => me());
		await news.save('dani', HOME, 'k');
		miniflux(entries([entry(1)]));
		await news.newsOf('dani');
		await news.newsOf('dani');
		expect(asked).toHaveLength(2);
		expect(await news.newsOf('eva')).toBeNull();
		await news.newsOf('dani', Date.now() + 16 * 60_000);
		expect(asked).toHaveLength(4);
	});

	test('a failure keeps what there was; with nothing, says so; a refused key, to change', async () => {
		const { deps: d } = deps();
		const news = minifluxNews(d);
		miniflux(() => me());
		await news.save('eva', HOME, 'k');
		miniflux(() => new Response('', { status: 500 }));
		expect((await news.newsOf('eva'))?.problem).toBe('down');

		const later = Date.now() + 3 * 60_000;
		miniflux(entries([entry(1)]));
		expect((await news.newsOf('eva', later))?.items).toHaveLength(1);

		miniflux(() => new Response('', { status: 500 }));
		const failed = await news.newsOf('eva', Date.now() + 16 * 60_000);
		expect(failed?.items).toHaveLength(1);
		expect(failed?.problem).toBeNull();

		miniflux(() => new Response('', { status: 401 }));
		const refused = await news.newsOf('eva', Date.now() + 32 * 60_000);
		expect(refused?.problem).toBe('key');
		expect(refused?.items).toEqual([]);
	});

	test('marked as read: off what is kept, and told to Miniflux; a failure only logged', async () => {
		const { deps: d } = deps();
		const news = minifluxNews(d);
		miniflux(() => me());
		await news.save('fran', HOME, 'k');
		miniflux(entries([entry(1), entry(2)]));
		await news.newsOf('fran');

		miniflux(() => new Response(null, { status: 204 }));
		await news.markRead('fran', 1);
		expect(asked[0]!.url.href).toBe(`${HOME}/v1/entries`);
		expect(asked[0]!.init.method).toBe('PUT');
		expect(JSON.parse(asked[0]!.init.body as string)).toEqual({
			entry_ids: [1],
			status: 'read'
		});
		const after = await news.newsOf('fran');
		expect(after?.items.map((i) => i.id)).toEqual([2]);
		expect(after?.groups[0]!.unread).toBe(1);

		miniflux(() => new Response('', { status: 500 }));
		await news.markRead('fran', 2);
		expect((await news.newsOf('fran'))?.items).toEqual([]);
	});

	test('removed: address and key forgotten, and no card', async () => {
		const { deps: d, kept } = deps();
		const news = minifluxNews(d);
		miniflux(() => me());
		await news.save('ana', HOME, 'k');
		miniflux(entries([entry(1)]));
		await news.newsOf('ana');
		await news.remove('ana');
		expect(kept.size).toBe(0);
		expect(await news.newsOf('ana')).toBeNull();
	});

	test('one person’s address, invisible to another', async () => {
		const { deps: d } = deps();
		const news = minifluxNews(d);
		miniflux(() => me());
		await news.save('ana', HOME, 'k');
		const seen = await asUser('bea', (tx) => tx.select().from(minifluxLink));
		expect(seen.map((r) => r.userId)).not.toContain('ana');
	});
});

describe('categories', () => {
	test('those with something unread; no counts in an old Miniflux, not a reason to skip', () => {
		expect(
			parseGroups(
				JSON.stringify([
					category(1, 3),
					category(2, 0),
					category(3, 5, true),
					{ id: 4, title: 'Vieja' }
				])
			)
		).toEqual([
			{ id: 1, title: 'Cat 1', unread: 3, hidden: false },
			{ id: 3, title: 'Cat 3', unread: 5, hidden: true },
			{ id: 4, title: 'Vieja', unread: null, hidden: false }
		]);
		expect(() => parseGroups('{"error":"no"}')).toThrow();
	});

	test('the newest of each: one writing a lot does not hide the others', async () => {
		const { deps: d } = deps();
		const news = minifluxNews(d);
		miniflux(() => me());
		await news.save('cris', HOME, 'k2');
		const busy = Array.from({ length: 20 }, (_, i) => entry(100 + i, undefined, 1));
		const quiet = [entry(1, 'Poco', 2), entry(2, 'Más', 2)];
		const hidden = [entry(50, 'Escondida', 3)];
		const old = { id: 4, title: 'Sin cuenta', user_id: 1 };
		miniflux(
			entries(
				[...busy, ...quiet, ...hidden, entry(60, 'De la vieja', 4)],
				[category(1, 20), category(2, 2), category(3, 1, true), category(5, 0), old as never]
			)
		);
		const card = (await news.newsOf('cris'))!;
		expect(asked.map((a) => a.url.pathname)).not.toContain('/v1/categories/5/entries');
		expect(card.groups.map((g) => [g.id, g.unread])).toEqual([
			[1, 20],
			[2, 2],
			[3, 1],
			[4, 1]
		]);
		expect(newsShown(card, 2).map((i) => i.title)).toEqual(['Más', 'Poco']);
		expect(newsShown(card, 1)).toHaveLength(MAX_NEWS);
		// «Todas»: the newest of all, but not the one hidden in Miniflux.
		const all = newsShown(card, null);
		expect(all.map((i) => i.id)).toEqual([119, 118, 117, 116, 115, 114, 113, 112]);
		expect(newsShown(card, 3).map((i) => i.id)).toEqual([50]);
		expect(all.map((i) => i.id)).not.toContain(50);
		// One gone: «Todas».
		expect(newsShown(card, 99)).toEqual(all);
		// Opened here: off the list and the count.
		expect(newsShown(card, 2, [2]).map((i) => i.id)).toEqual([1]);
		expect(newsUnread(card, card.groups[1]!, [2])).toBe(1);
	});

	test('one category failing: like Miniflux down, what there was kept', async () => {
		const { deps: d } = deps();
		const news = minifluxNews(d);
		miniflux(() => me());
		await news.save('dani', HOME, 'k3');
		miniflux((url) =>
			url.pathname === '/v1/categories/2/entries'
				? new Response('', { status: 500 })
				: entries([entry(1)], [category(1, 1), category(2, 1)])(url)
		);
		expect((await news.newsOf('dani'))?.problem).toBe('down');
	});
});
