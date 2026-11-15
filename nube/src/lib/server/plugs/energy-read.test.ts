import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { family, familySettings, plug, plugEnergy } from '../db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily } from '../family-scope.ts';
import type { Kitchen } from '../fridge.ts';

/** Preguntar's read_plug_energy on a real Postgres (PGlite), as the app's role: only the family's. */
const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const withFamily = familyScope(db, { role: 'app_user' });
mock.module('../db/index.ts', () => ({ db }));
mock.module('../family.ts', () => ({ withFamily, asFamily, NoFamily }));
const { describePlugEnergy: read } = await import('./energy-read.ts');
/** Its text with plain spaces: euros come with a non-breaking one before «€». */
const describePlugEnergy = async (...args: Parameters<typeof read>) =>
	(await read(...args)).replaceAll('\u00a0', ' ');
const kitchen = (familyId: string): Kitchen => ({
	familyId,
	userId: null,
	run: (fn) => asFamily(familyId, fn)
});
/** An hour of a day in Madrid (CET in January: UTC+1). */
const at = (day: string, hour: number) =>
	new Date(`${day}T${String(hour - 1).padStart(2, '0')}:00:00Z`);

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familySettings).values({ familyId: 'A', kwhPrice: 0.2 });
	await db.insert(plug).values([
		{
			id: 'p1',
			familyId: 'A',
			name: 'Termo',
			kind: 'termo',
			hash: 'h1',
			createdAt: at('2026-01-01', 1)
		},
		{
			id: 'p2',
			familyId: 'A',
			name: 'Radiador del salón',
			kind: 'otro',
			hash: 'h2',
			createdAt: at('2026-01-02', 9)
		},
		{
			id: 'p3',
			familyId: 'B',
			name: 'Termo',
			kind: 'termo',
			hash: 'h3',
			createdAt: at('2026-01-01', 1)
		}
	]);
	await db.insert(plugEnergy).values([
		{ plugId: 'p1', familyId: 'A', hour: at('2026-01-01', 6), wh: 1500 },
		{ plugId: 'p1', familyId: 'A', hour: at('2026-01-01', 7), wh: 1000 },
		// The last hour of the 2nd in Madrid, though the 2nd's 23:00 UTC.
		{ plugId: 'p1', familyId: 'A', hour: at('2026-01-02', 23), wh: 500 },
		{ plugId: 'p2', familyId: 'A', hour: at('2026-01-02', 20), wh: 2000 },
		{ plugId: 'p3', familyId: 'B', hour: at('2026-01-02', 20), wh: 9999 }
	]);
});

test('all the family’s plugs, day by day with each one, the total and euros at its price', async () => {
	const said = await describePlugEnergy(kitchen('A'), {
		from_day: '2026-01-01',
		to_day: '2026-01-03'
	});
	const lines = said.split('\n');
	expect(lines[0]).toContain(
		'los enchufes (Termo, Radiador del salón) del 2026-01-01 al 2026-01-03'
	);
	expect(lines[0]).toContain('puesto a mano');
	expect(lines.slice(1, 5)).toEqual([
		'2026-01-01: 2,5 kWh, 0,50 € (Termo 2,5 kWh)',
		'2026-01-02: 2,5 kWh, 0,50 € (Radiador del salón 2 kWh, Termo 500 Wh)',
		'2026-01-03: nada',
		'En total: 5 kWh, 1,00 € (Termo 3 kWh, Radiador del salón 2 kWh).'
	]);
	expect(said).toContain('«Radiador del salón» está desde el 2026-01-02');
	expect(said).not.toContain('9999');
});

test('one plug by part of its name, accents and case aside', async () => {
	const said = await describePlugEnergy(kitchen('A'), { plug: 'RADIADOR', from_day: '2026-01-02' });
	expect(said.split('\n').slice(0, 3)).toEqual([
		expect.stringContaining('«Radiador del salón» del 2026-01-02 al 2026-01-02'),
		'2026-01-02: 2 kWh, 0,40 €',
		'En total: 2 kWh, 0,40 €.'
	]);
});

test('what cannot be read is said', async () => {
	expect(await describePlugEnergy(kitchen('A'), { plug: 'nevera', from_day: '2026-01-01' })).toBe(
		'Ningún enchufe se llama así. Los de la familia: Termo, Radiador del salón.'
	);
	expect(
		await describePlugEnergy(kitchen('A'), {
			plug: 'radiador',
			from_day: '2025-12-30',
			to_day: '2025-12-31'
		})
	).toBe('Esos días aún no había «Radiador del salón» en Enchufes.');
	expect(
		await describePlugEnergy(kitchen('A'), { from_day: '2026-01-01', to_day: '2026-06-01' })
	).toContain('Como mucho 92 días');
	expect(await describePlugEnergy(kitchen('C'), { from_day: '2026-01-01' })).toBe(
		'La familia no tiene enchufes en Enchufes.'
	);
});
