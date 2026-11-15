import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { bill, expense, family, familySettings, plug, plugEnergy } from '../db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily } from '../family-scope.ts';
import type { Kitchen } from '../fridge.ts';

/**
 * Energía → Previsión (#513) on a real Postgres (PGlite), Open-Meteo faked: from plugs and bills
 * made to follow a known line, the line is found again, and the next days' light from it.
 */
const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const withFamily = familyScope(db, { role: 'app_user' });
mock.module('../db/index.ts', () => ({ db }));
mock.module('../family.ts', () => ({ withFamily, asFamily, NoFamily }));
// Its real one needs the KMS: «Dónde vivís» read as it is, from the family's settings.
mock.module('../family-settings.ts', () => ({
	familyPlace: async (k: Kitchen) =>
		(await k.run((tx) => tx.select({ place: familySettings.place }).from(familySettings)))[0]
			?.place ?? null,
	orsKey: async () => null
}));
const agenda = { ...(await import('comun/agenda.ts')) };
const TODAY = '2026-11-15';
mock.module('comun/agenda.ts', () => ({ ...agenda, localDay: () => TODAY }));
const { energyForecast } = await import('./forecast.ts');
const { addDays } = agenda;

const kitchen = (familyId: string): Kitchen => ({
	familyId,
	userId: null,
	run: (fn) => asFamily(familyId, fn)
});

/** Each day's mean: colder and warmer days in turn, so the cold can be told apart. */
const meanOf = (day: string) => {
	const at = new Date(`${day}T12:00:00Z`);
	// And each month two degrees colder than the one before: bills of different cold.
	return [16, 12, 8, 4][at.getUTCDate() % 4]! - 2 * (at.getUTCMonth() - 5);
};
const degreesOf = (day: string) => Math.max(0, meanOf(day) <= 15 ? 18 - meanOf(day) : 0);
/** The house: 3 kWh a day with no cold, 0,5 more per degree-day; the plugs, half of it. */
const house = (day: string) => 3 + 0.5 * degreesOf(day);

const realFetch = globalThis.fetch;
beforeAll(async () => {
	globalThis.fetch = (async (url: URL) => {
		const time: string[] = [];
		for (
			let d = url.searchParams.get('start_date')!;
			d <= url.searchParams.get('end_date')!;
			d = addDays(d, 1)
		)
			time.push(d);
		return Response.json({
			daily: {
				time,
				weather_code: time.map(() => 3),
				temperature_2m_min: time.map((d) => meanOf(d) - 3),
				temperature_2m_max: time.map((d) => meanOf(d) + 3),
				temperature_2m_mean: time.map(meanOf),
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
	await db
		.insert(familySettings)
		.values([{ familyId: 'A', place, kwhPrice: 0.2 }, { familyId: 'B', place }, { familyId: 'C' }]);
	// A: a plug for 40 days, its kWh each day at noon in Madrid.
	await db.insert(plug).values([
		{
			id: 'p1',
			familyId: 'A',
			name: 'Radiador',
			kind: 'otro',
			hash: 'h1',
			createdAt: new Date(`${addDays(TODAY, -41)}T09:00:00Z`)
		},
		{
			id: 'p2',
			familyId: 'B',
			name: 'Lámpara',
			kind: 'lampara',
			hash: 'h2',
			createdAt: new Date(`${addDays(TODAY, -5)}T09:00:00Z`)
		}
	]);
	const energy = [];
	for (let day = addDays(TODAY, -40); day < TODAY; day = addDays(day, 1))
		energy.push({
			plugId: 'p1',
			familyId: 'A',
			hour: new Date(`${day}T11:00:00Z`),
			wh: (house(day) / 2) * 1000
		});
	await db.insert(plugEnergy).values(energy);
	// A: four light bills of a month, each its kWh by the same line.
	for (const start of ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']) {
		const end = addDays(addDays(start, 30), -1);
		let kwh = 0;
		for (let d = start; d <= end; d = addDays(d, 1)) kwh += house(d);
		const [e] = await db
			.insert(expense)
			.values({
				familyId: 'A',
				date: end,
				store: 'Luz',
				category: 'Facturas',
				total: 5000,
				source: 'factura'
			})
			.returning({ id: expense.id });
		await db.insert(bill).values({
			familyId: 'A',
			expenseId: e!.id,
			kind: 'Luz',
			periodStart: start,
			periodEnd: end,
			consumption: kwh,
			unit: 'kWh',
			details: {
				tariff: null,
				consumption: [],
				power: [],
				powerPrice: [],
				maxPower: [],
				unitPrice: null,
				pricing: null,
				energyPrice: [],
				electricityTax: null,
				vat: null,
				areaAverage: null
			}
		});
	}
});
afterAll(() => {
	globalThis.fetch = realFetch;
});

test('the next 15 days’ cold, and the light learned from the plugs and from the bills', async () => {
	const f = await energyForecast(kitchen('A'));
	if (!f || typeof f === 'string') throw new Error(String(f));
	expect(f.days).toHaveLength(15);
	expect(f.days[0]).toMatchObject({ day: TODAY, mean: meanOf(TODAY), degrees: degreesOf(TODAY) });
	let degrees = 0;
	let before = 0;
	for (let i = 0; i < 15; i++) {
		degrees += degreesOf(addDays(TODAY, i));
		before += degreesOf(addDays(TODAY, -15 + i));
	}
	expect(f.degrees).toBe(degrees);
	expect(f.degreesBefore).toBe(before);

	if (!f.plugs || !('learned' in f.plugs)) throw new Error('Sin aprender de los enchufes');
	const plugs = f.plugs.learned;
	expect(plugs.fit.n).toBe(40);
	expect(plugs.fit.base).toBeCloseTo(1.5, 5);
	expect(plugs.fit.perDegree).toBeCloseTo(0.25, 5);
	expect(plugs.expected.kwh).toBeCloseTo(15 * 1.5 + 0.25 * degrees, 5);
	expect(plugs.euros!.kwh).toBeCloseTo(plugs.expected.kwh * 0.2, 5);

	if (!f.bills || !('learned' in f.bills)) throw new Error('Sin aprender de las facturas');
	expect(f.bills.learned.fit.n).toBe(4);
	expect(f.bills.learned.fit.base).toBeCloseTo(3, 5);
	expect(f.bills.learned.fit.perDegree).toBeCloseTo(0.5, 5);
});

test('still learning, said with how far; no bills nor plugs, nothing; no place, null', async () => {
	const b = await energyForecast(kitchen('B'));
	if (!b || typeof b === 'string') throw new Error(String(b));
	expect(b.plugs).toEqual({ have: 4, need: 14 });
	expect(b.bills).toBeNull();
	expect(await energyForecast(kitchen('C'))).toBeNull();
});
