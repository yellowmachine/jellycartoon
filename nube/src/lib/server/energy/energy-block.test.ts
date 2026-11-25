import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import {
	family,
	familySettings,
	fuel,
	fuelSpot,
	fuelUnit,
	plug,
	plugEnergy
} from '../db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily } from '../family-scope.ts';
import type { Kitchen } from '../fridge.ts';

/**
 * Informes' «energia» block (#513 phase 4) on a real Postgres (PGlite), Open-Meteo faked with a
 * mean of 8 °C (10 degree-days): each day's plugs in Spain's days, the bottles started, nothing of
 * another family, and only days gone.
 */
const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const withFamily = familyScope(db, { role: 'app_user' });
mock.module('../db/index.ts', () => ({ db }));
mock.module('../family.ts', () => ({ withFamily, asFamily, NoFamily }));
mock.module('../family-settings.ts', () => ({
	familyPlace: async (k: Kitchen) =>
		(await k.run((tx) => tx.select({ place: familySettings.place }).from(familySettings)))[0]
			?.place ?? null,
	orsKey: async () => null,
	openRouterKey: async () => null
}));
const agenda = { ...(await import('comun/agenda.ts')) };
const TODAY = '2026-11-15';
mock.module('comun/agenda.ts', () => ({ ...agenda, localDay: () => TODAY }));
const { energyBlock } = await import('./energy-block.ts');

const kitchen = (familyId: string): Kitchen => ({
	familyId,
	userId: null,
	run: (fn) => asFamily(familyId, fn)
});

const realFetch = globalThis.fetch;
beforeAll(async () => {
	globalThis.fetch = (async (url: URL) => {
		const time: string[] = [];
		for (
			let d = url.searchParams.get('start_date')!;
			d <= url.searchParams.get('end_date')!;
			d = agenda.addDays(d, 1)
		)
			time.push(d);
		return Response.json({
			daily: {
				time,
				weather_code: time.map(() => 3),
				temperature_2m_min: time.map(() => 4),
				temperature_2m_max: time.map(() => 12),
				temperature_2m_mean: time.map(() => 8),
				precipitation_sum: time.map(() => 0)
			}
		});
	}) as typeof fetch;
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' },
		{ id: 'C', name: 'Casa C' }
	]);
	const place = { name: 'Pueblo', region: null, country: null, lat: 37.6, lon: -2.1 };
	await db.insert(familySettings).values([
		{ familyId: 'A', place, kwhPrice: 0.2 },
		{ familyId: 'B', place },
		{ familyId: 'C', place }
	]);
	await db.insert(plug).values([
		{ id: 'p1', familyId: 'A', name: 'Radiador', kind: 'otro', hash: 'h1' },
		{ id: 'p2', familyId: 'B', name: 'Lámpara', kind: 'lampara', hash: 'h2' }
	]);
	await db.insert(plugEnergy).values([
		// 12th: 2 kWh at noon, and 1 at 23:30 in Madrid (22:30 UTC), still the 12th.
		{ plugId: 'p1', familyId: 'A', hour: new Date('2026-11-12T11:00:00Z'), wh: 2000 },
		{ plugId: 'p1', familyId: 'A', hour: new Date('2026-11-12T22:00:00Z'), wh: 1000 },
		// 13th at 0:30 in Madrid (23:30 UTC of the 12th): the 13th.
		{ plugId: 'p1', familyId: 'A', hour: new Date('2026-11-12T23:00:00Z'), wh: 500 },
		// Another family's.
		{ plugId: 'p2', familyId: 'B', hour: new Date('2026-11-12T11:00:00Z'), wh: 9000 }
	]);
	const [butane] = await db
		.insert(fuel)
		.values({ familyId: 'A', kind: 'butano', startsOnBuy: true })
		.returning({ id: fuel.id });
	const [spot] = await db
		.insert(fuelSpot)
		.values({ familyId: 'A', fuelId: butane!.id })
		.returning({ id: fuelSpot.id });
	const unit = { familyId: 'A', fuelId: butane!.id, spotId: spot!.id };
	await db.insert(fuelUnit).values([
		{ ...unit, startedOn: '2026-11-12' },
		{ ...unit, startedOn: '2026-11-01', endedOn: '2026-11-12' }
	]);
});
afterAll(() => {
	globalThis.fetch = realFetch;
});

test('each day its plugs (Spain’s days) and its cold, the bottles started, up to yesterday', async () => {
	const b = await energyBlock(kitchen('A'), '2026-11-12', '2026-11-20');
	if (typeof b === 'string') throw new Error(b);
	expect(b.place).toBe('Pueblo');
	expect(b.price).toBe(0.2);
	expect(b.days.map((d) => d.day)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
	expect(b.days.map((d) => d.kwh)).toEqual([3, 0.5, 0]);
	expect(b.days.every((d) => d.degrees === 10)).toBe(true);
	expect(b.fuels).toEqual([{ kind: 'butano', units: 1 }]);
});

test('another family sees only its own; a family with nothing in Energía, said so', async () => {
	const b = await energyBlock(kitchen('B'), '2026-11-12', '2026-11-12');
	if (typeof b === 'string') throw new Error(b);
	expect(b.days[0]!.kwh).toBe(9);
	expect(b.fuels).toEqual([]);
	expect(await energyBlock(kitchen('C'), '2026-11-12', '2026-11-12')).toContain(
		'no tiene enchufes'
	);
	expect(await energyBlock(kitchen('A'), '2026-11-16', '2026-11-20')).toContain(
		'aún no han pasado'
	);
});
