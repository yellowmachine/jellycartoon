import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { bill, expense, family, familySettings } from '../db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily } from '../family-scope.ts';
import type { Kitchen } from '../fridge.ts';

/**
 * Solar panels (#513 phase 3) on a real Postgres (PGlite), Open-Meteo faked: 500 W/m² on the panels
 * from 9 to 17 every day and a mean of 8 °C. What the house uses: said, or learned from the light
 * bills before the panels (not those after, which only say the grid); nothing of another family.
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
const { addDays } = agenda;
const solar = await import('./solar.ts');

const kitchen = (familyId: string): Kitchen => ({
	familyId,
	userId: null,
	run: (fn) => asFamily(familyId, fn)
});

const realFetch = globalThis.fetch;
beforeAll(async () => {
	globalThis.fetch = (async (url: URL) => {
		const days: string[] = [];
		for (
			let d = url.searchParams.get('start_date')!;
			d <= url.searchParams.get('end_date')!;
			d = addDays(d, 1)
		)
			days.push(d);
		if (url.searchParams.get('hourly') === 'global_tilted_irradiance') {
			// Each value is the hour before its time: 10:00 to 17:00 are the hours from 9 to 17.
			const time = days.flatMap((d) =>
				Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`)
			);
			return Response.json({
				hourly: {
					time,
					global_tilted_irradiance: time.map((t) => {
						const h = Number(t.slice(11, 13));
						return h >= 10 && h <= 17 ? 500 : 0;
					})
				}
			});
		}
		return Response.json({
			daily: {
				time: days,
				weather_code: days.map(() => 3),
				temperature_2m_min: days.map(() => 4),
				temperature_2m_max: days.map(() => 12),
				temperature_2m_mean: days.map(() => 8),
				precipitation_sum: days.map(() => 0)
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
		{ id: 'B', name: 'Casa B' }
	]);
	const place = { name: 'Pueblo', region: null, country: null, lat: 37.6, lon: -2.1 };
	await db.insert(familySettings).values([
		{ familyId: 'A', place },
		{ familyId: 'B', place }
	]);
	// Light bills of A: three of 10 kWh a day before the panels (1 September), one of 2 after.
	for (const [start, end, kwh] of [
		['2026-06-01', '2026-06-30', 300],
		['2026-07-01', '2026-07-31', 310],
		['2026-08-01', '2026-08-31', 310],
		['2026-09-01', '2026-09-30', 60]
	] as const) {
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

const input = (fields: Record<string, string>) => {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const r = solar.solarInput(form, TODAY);
	if (typeof r === 'string') throw new Error(r);
	return r;
};

test('no panels: nothing; added, it asks what the house uses', async () => {
	expect(await solar.solarState(kitchen('A'))).toBeNull();
	await solar.addSolar(kitchen('A'));
	await solar.addSolar(kitchen('A'));
	const s = await solar.solarState(kitchen('A'));
	expect(s!.row.groups).toEqual([{ kwp: 4, tilt: 30, azimuth: 0 }]);
	expect(s!.forecast).toEqual({ days: [], use: { by: null, bills: null }, price: null });
	// Another family's panels are not seen.
	expect(await solar.solarState(kitchen('B'))).toBeNull();
});

test('with what the house uses said: 15 days of what the panels make, the battery and the grid', async () => {
	await solar.saveSolar(
		kitchen('A'),
		input({ kwp0: '4', tilt0: '30', azimuth0: '0', batteryKwh: '10', reserve: '10', dayKwh: '10' })
	);
	const s = await solar.solarState(kitchen('A'));
	const f = s!.forecast;
	if (!f || typeof f === 'string') throw new Error(String(f));
	expect(f.use).toEqual({ by: 'dicho', kwh: 10 });
	expect(f.days).toHaveLength(15);
	expect(f.days[0]!.day).toBe(TODAY);
	for (const d of f.days) {
		// 4 kWp × 0,5 kW/m² × 0,8 × 8 hours.
		expect(d.made).toBeCloseTo(12.8, 6);
		expect(d.used).toBeCloseTo(10, 2);
	}
	// 12,8 made against 10 used, 9 kWh of battery: it fills and carries the night.
	expect(f.days[3]).toMatchObject({ full: true, emptyAt: null });
	expect(f.days[3]!.fromGrid).toBeCloseTo(0, 6);
});

test('without it said: learned from the bills before the panels, not those after', async () => {
	await solar.saveSolar(
		kitchen('A'),
		input({ kwp0: '4', tilt0: '30', azimuth0: '0', installedOn: '2026-09-01' })
	);
	const f = (await solar.solarState(kitchen('A')))!.forecast;
	if (!f || typeof f === 'string' || f.use.by !== 'facturas') throw new Error(JSON.stringify(f));
	expect(f.use.fit.n).toBe(3);
	expect(f.use.fit.base).toBeCloseTo(10, 0);
	expect(f.days[0]!.used).toBeCloseTo(f.use.fit.base, 1);
	// Without a battery the night is from the grid, and the midday sun is left over.
	expect(f.days[2]!.fromGrid).toBeGreaterThan(5);
	expect(f.days[2]!.spare).not.toBeNull();

	// Panels since before the bills: none from before, so it says so.
	await solar.saveSolar(
		kitchen('A'),
		input({ kwp0: '4', tilt0: '30', azimuth0: '0', installedOn: '2026-05-01' })
	);
	const g = (await solar.solarState(kitchen('A')))!.forecast;
	expect(g).toMatchObject({ days: [], use: { by: null, bills: { have: 0, need: 3 } } });
});

test('the form: groups by line, empty ones left out, what does not make sense said', () => {
	const r = input({
		kwp0: '3,2',
		tilt0: '25',
		azimuth0: '-90',
		kwp1: '',
		kwp2: '2',
		azimuth2: '90',
		batteryKwh: '',
		inverterKw: '5'
	});
	expect(r).toEqual({
		groups: [
			{ kwp: 3.2, tilt: 25, azimuth: -90 },
			{ kwp: 2, tilt: 30, azimuth: 90 }
		],
		inverterKw: 5,
		batteryKwh: null,
		reserve: 10,
		dayKwh: null,
		installedOn: null
	});
	const bad = (fields: Record<string, string>) => {
		const form = new FormData();
		for (const [k, v] of Object.entries(fields)) form.set(k, v);
		return solar.solarInput(form, TODAY);
	};
	expect(bad({})).toBe('Pon los kWp de los paneles');
	expect(bad({ kwp0: '4', tilt0: '120' })).toContain('inclinación');
	expect(bad({ kwp0: '4', installedOn: '2027-01-01' })).toContain('día');
	expect(bad({ kwp0: 'x' })).toContain('kWp');
});
