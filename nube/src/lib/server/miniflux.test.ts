import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { minifluxLink, user } from './db/schema.ts';
import { userScope } from './family-scope.ts';
import { MAX_NEWS, minifluxNews, minifluxUrl, parseEntries } from './miniflux.ts';

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

const entry = (id: number, title = `Noticia ${id}`) => ({
	id,
	title,
	url: `https://periodico.example/${id}`,
	published_at: '2026-11-06T10:00:00+01:00',
	content: '<p>artículo entero</p>',
	feed: { title: 'El Periódico' }
});
const entries = (...list: unknown[]) => Response.json({ total: list.length, entries: list });
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
				at: '2026-11-06T09:00:00.000Z',
				source: 'El Periódico'
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
		miniflux(() => entries(...Array.from({ length: 12 }, (_, i) => entry(i + 1))));
		const card = await news.newsOf('cris');
		expect(card?.items).toHaveLength(MAX_NEWS);
		expect(card?.problem).toBeNull();
		const asks = asked[0]!.url.searchParams;
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
		miniflux(() => entries(entry(1)));
		await news.newsOf('dani');
		await news.newsOf('dani');
		expect(asked).toHaveLength(1);
		expect(await news.newsOf('eva')).toBeNull();
		await news.newsOf('dani', Date.now() + 16 * 60_000);
		expect(asked).toHaveLength(2);
	});

	test('a failure keeps what there was; with nothing, says so; a refused key, to change', async () => {
		const { deps: d } = deps();
		const news = minifluxNews(d);
		miniflux(() => me());
		await news.save('eva', HOME, 'k');
		miniflux(() => new Response('', { status: 500 }));
		expect((await news.newsOf('eva'))?.problem).toBe('down');

		const later = Date.now() + 3 * 60_000;
		miniflux(() => entries(entry(1)));
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
		miniflux(() => entries(entry(1), entry(2)));
		await news.newsOf('fran');

		miniflux(() => new Response(null, { status: 204 }));
		await news.markRead('fran', 1);
		expect(asked[0]!.url.href).toBe(`${HOME}/v1/entries`);
		expect(asked[0]!.init.method).toBe('PUT');
		expect(JSON.parse(asked[0]!.init.body as string)).toEqual({
			entry_ids: [1],
			status: 'read'
		});
		expect((await news.newsOf('fran'))?.items.map((i) => i.id)).toEqual([2]);

		miniflux(() => new Response('', { status: 500 }));
		await news.markRead('fran', 2);
		expect((await news.newsOf('fran'))?.items).toEqual([]);
	});

	test('removed: address and key forgotten, and no card', async () => {
		const { deps: d, kept } = deps();
		const news = minifluxNews(d);
		miniflux(() => me());
		await news.save('ana', HOME, 'k');
		miniflux(() => entries(entry(1)));
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
