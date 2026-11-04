import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, seriesTag, tag } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';
import { ensureTags, linkSeries, releaseTag, renameTag, unlinkSeries } from './tags.ts';

/** Piloto de Electric (#394): las etiquetas, cada familia las suyas, como `family-scope.test.ts`. */
const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });

let tagA: number;

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'a', name: 'A' },
		{ id: 'b', name: 'B' }
	]);
	[{ id: tagA }] = await asFamily('a', (tx) =>
		tx.insert(tag).values({ familyId: 'a', name: 'infantil' }).returning({ id: tag.id })
	);
	await asFamily('a', (tx) =>
		tx.insert(seriesTag).values({ familyId: 'a', seriesId: 7, tagId: tagA })
	);
});

describe('etiquetas', () => {
	test('la misma etiqueta y la misma serie, en dos familias', async () => {
		const [{ id }] = await asFamily('b', (tx) =>
			tx.insert(tag).values({ familyId: 'b', name: 'infantil' }).returning({ id: tag.id })
		);
		expect(id).not.toBe(tagA);
		await asFamily('b', (tx) =>
			tx.insert(seriesTag).values({ familyId: 'b', seriesId: 7, tagId: id })
		);
	});

	test('cada familia ve solo las suyas', async () => {
		const rows = await asFamily('a', (tx) => tx.select().from(tag));
		expect(rows.map((r) => r.familyId)).toEqual(['a']);
		const links = await asFamily('a', (tx) => tx.select().from(seriesTag));
		expect(links.map((r) => r.familyId)).toEqual(['a']);
	});

	test('no se escribe en otra familia', async () => {
		await expect(
			asFamily('b', (tx) => tx.insert(tag).values({ familyId: 'a', name: 'colada' }))
		).rejects.toThrow();
	});

	test('una familia no enlaza con la etiqueta de otra', async () => {
		await expect(
			asFamily('b', (tx) =>
				tx.insert(seriesTag).values({ familyId: 'b', seriesId: 8, tagId: tagA })
			)
		).rejects.toThrow();
	});
});

describe('lo que escribe la casa', () => {
	const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

	test('crear y enlazar, sin duplicar', async () => {
		const one = await asFamily('b', (tx) => linkSeries(tx, 'b', 20, 'nueva'));
		const two = await asFamily('b', (tx) => linkSeries(tx, 'b', 20, 'nueva'));
		expect(two.id).toBe(one.id);
		const again = await asFamily('b', (tx) => ensureTags(tx, 'b', ['nueva', 'otra']));
		expect(names(again)).toEqual(['nueva', 'otra']);
	});

	test('desenlazar borra la etiqueta sin usar, salvo si la usa la casa', async () => {
		const t = await asFamily('b', (tx) => linkSeries(tx, 'b', 21, 'de-peli'));
		await asFamily('b', (tx) => unlinkSeries(tx, 21, t.id, true));
		expect(names(await asFamily('b', (tx) => tx.select().from(tag)))).toContain('de-peli');
		await asFamily('b', (tx) => releaseTag(tx, t.id, false));
		expect(names(await asFamily('b', (tx) => tx.select().from(tag)))).not.toContain('de-peli');
	});

	test('no se borra si otra serie la tiene', async () => {
		const t = await asFamily('b', (tx) => linkSeries(tx, 'b', 22, 'dos'));
		await asFamily('b', (tx) => linkSeries(tx, 'b', 23, 'dos'));
		await asFamily('b', (tx) => unlinkSeries(tx, 22, t.id, false));
		expect(names(await asFamily('b', (tx) => tx.select().from(tag)))).toContain('dos');
	});

	test('renombrar a una que ya existe las junta', async () => {
		const x = await asFamily('b', (tx) => linkSeries(tx, 'b', 30, 'mal'));
		const y = await asFamily('b', (tx) => linkSeries(tx, 'b', 31, 'bien'));
		const done = await asFamily('b', (tx) => renameTag(tx, 'b', x.id, 'bien'));
		expect(done.mergedInto).toBe(y.id);
		const links = await asFamily('b', (tx) => tx.select().from(seriesTag));
		expect(
			links
				.filter((l) => l.tagId === y.id)
				.map((l) => l.seriesId)
				.sort()
		).toEqual([30, 31]);
	});

	test('con el id de otra familia, no toca nada', async () => {
		await asFamily('b', (tx) => unlinkSeries(tx, 7, tagA, false));
		await asFamily('b', (tx) => renameTag(tx, 'b', tagA, 'robada'));
		const rows = await asFamily('a', (tx) => tx.select().from(tag));
		expect(names(rows)).toEqual(['infantil']);
		expect(await asFamily('a', (tx) => tx.select().from(seriesTag))).toHaveLength(1);
	});
});
