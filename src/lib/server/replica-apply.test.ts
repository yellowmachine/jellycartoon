import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { movie, movieTag, seriesTag, tag } from '#lib/server/db/schema.ts';
import {
	applyChanges,
	foldChange,
	readPosition,
	replaceAll,
	rowKey
} from '#lib/server/replica-apply.ts';

/** Lo que baja de Seilide (#394), en un Postgres de verdad, con las migraciones tal cual. */
const db = drizzle(new PGlite());
const at = (offset: string) => ({ handle: 'h', offset });

beforeAll(() => migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` }));
beforeEach(async () => {
	await db.delete(movie);
	await db.delete(seriesTag);
	await db.delete(tag);
});

describe('applyChanges', () => {
	test('alta, cambio y baja, en orden', async () => {
		await applyChanges(
			db,
			'tag',
			[
				{ operation: 'insert', value: { id: 1, name: 'infantil' } },
				{ operation: 'insert', value: { id: 2, name: 'comedia' } },
				{ operation: 'update', value: { id: 1, name: 'peques' } },
				{ operation: 'delete', value: { id: 2 } }
			],
			at('1_0')
		);
		expect(await db.select().from(tag)).toEqual([{ id: 1, name: 'peques' }]);
		expect(await readPosition(db, 'tag')).toEqual(at('1_0'));
	});

	test('sin family_id, y antes que su etiqueta', async () => {
		await applyChanges(
			db,
			'series_tag',
			[{ operation: 'insert', value: { family_id: 'a', series_id: 7, tag_id: 99 } }],
			at('1_0')
		);
		expect(await db.select().from(seriesTag)).toEqual([{ seriesId: 7, tagId: 99 }]);
	});

	test('repetir una tanda no duplica', async () => {
		const change = [
			{ operation: 'insert' as const, value: { family_id: 'a', series_id: 7, tag_id: 1 } }
		];
		await applyChanges(db, 'series_tag', change, at('1_0'));
		await applyChanges(db, 'series_tag', change, at('1_0'));
		expect(await db.select().from(seriesTag)).toHaveLength(1);
	});

	test('si falla, ni los cambios ni la posición', async () => {
		await applyChanges(db, 'tag', [], at('1_0'));
		await expect(
			applyChanges(
				db,
				'tag',
				[
					{ operation: 'insert', value: { id: 1, name: 'infantil' } },
					{ operation: 'insert', value: { id: 2, name: 'infantil' } }
				],
				at('2_0')
			)
		).rejects.toThrow();
		expect(await db.select().from(tag)).toEqual([]);
		expect(await readPosition(db, 'tag')).toEqual(at('1_0'));
	});
});

describe('replaceAll', () => {
	test('deja justo lo que llega, sin tocar lo que sigue en la casa', async () => {
		await db.insert(tag).values([
			{ id: 1, name: 'infantil' },
			{ id: 2, name: 'sobra' }
		]);
		const [film] = await db
			.insert(movie)
			.values({ path: '/x.mkv', title: 'x', size: 1, mtime: new Date() })
			.returning({ id: movie.id });
		await db.insert(movieTag).values({ movieId: film.id, tagId: 1 });

		await replaceAll(
			db,
			'tag',
			[
				{ id: 1, name: 'peques' },
				{ id: 3, name: 'nueva' }
			],
			at('5_0')
		);
		const rows = await db.select().from(tag).orderBy(tag.id);
		expect(rows).toEqual([
			{ id: 1, name: 'peques' },
			{ id: 3, name: 'nueva' }
		]);
		expect(await db.select().from(movieTag)).toHaveLength(1);
		expect(await readPosition(db, 'tag')).toEqual(at('5_0'));
	});

	test('series_tag, también', async () => {
		await db.insert(seriesTag).values({ seriesId: 1, tagId: 1 });
		await replaceAll(db, 'series_tag', [{ family_id: 'a', series_id: 2, tag_id: 1 }], at('5_0'));
		expect(await db.select().from(seriesTag)).toEqual([{ seriesId: 2, tagId: 1 }]);
	});
});

test('foldChange junta los cambios de una carga', () => {
	const rows = new Map<string, Record<string, unknown>>();
	foldChange('tag', rows, { operation: 'insert', value: { id: 1, name: 'a' } });
	foldChange('tag', rows, { operation: 'insert', value: { id: 2, name: 'b' } });
	foldChange('tag', rows, { operation: 'update', value: { id: 1, name: 'c' } });
	foldChange('tag', rows, { operation: 'delete', value: { id: 2 } });
	expect([...rows.values()]).toEqual([{ id: 1, name: 'c' }]);
	expect(rowKey('series_tag', { series_id: 1, tag_id: 2 })).toBe('1/2');
});
