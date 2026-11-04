import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, seriesTag, tag } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';

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
