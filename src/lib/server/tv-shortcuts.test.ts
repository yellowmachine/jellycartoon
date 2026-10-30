import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '#lib/server/db/schema.ts';
import { tag } from '#lib/server/db/schema.ts';

/**
 * The TV view's shortcuts (#327): a child sees only those tagged «infantil», and their tags are the
 * series' and films' ones. On a real Postgres (PGlite, in memory) with the migrations as they are.
 */
const db = drizzle(new PGlite(), { schema });
mock.module('#lib/server/db/index.ts', () => ({ db }));
const { tvShortcuts, openableShortcut, saveTvShortcut, deleteTvShortcut, parseTags, shortcutUrl } =
	await import('./tv-shortcuts.ts');

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
});

describe('shortcuts', () => {
	test('a child sees only the children’s', async () => {
		await saveTvShortcut({ name: 'NBA', url: 'https://www.nba.com/watch', tags: 'Deportes' });
		await saveTvShortcut({
			name: 'Crunchyroll',
			url: 'https://www.crunchyroll.com/es/',
			tags: ' Infantil , dibujos, infantil'
		});
		expect((await tvShortcuts(false)).map((s) => [s.name, s.tags])).toEqual([
			['Crunchyroll', ['dibujos', 'infantil']],
			['NBA', ['deportes']]
		]);
		expect((await tvShortcuts(true)).map((s) => s.name)).toEqual(['Crunchyroll']);
		const nba = (await tvShortcuts(false)).find((s) => s.name === 'NBA')!;
		expect(await openableShortcut(nba.id, true)).toBeNull();
		expect(await openableShortcut(nba.id, false)).not.toBeNull();
	});

	test('a tag nothing has any more goes; a shared one stays', async () => {
		const crunchy = (await tvShortcuts(false)).find((s) => s.name === 'Crunchyroll')!;
		await saveTvShortcut({ id: crunchy.id, name: 'Crunchyroll', url: crunchy.url, tags: '' });
		expect(await tvShortcuts(true)).toEqual([]);
		const nba = (await tvShortcuts(false)).find((s) => s.name === 'NBA')!;
		await deleteTvShortcut(nba.id);
		expect((await db.select({ name: tag.name }).from(tag)).map((t) => t.name)).toEqual([]);
	});

	test('only a whole address, http or https', () => {
		expect(shortcutUrl(' https://www.nba.com ')).toBe('https://www.nba.com/');
		expect(() => shortcutUrl('nba.com')).toThrow();
		expect(() => shortcutUrl('javascript:alert(1)')).toThrow();
		expect(parseTags('Infantil, ,dibujos,  infantil ')).toEqual(['infantil', 'dibujos']);
	});
});
