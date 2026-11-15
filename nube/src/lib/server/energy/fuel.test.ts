import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { expense, family, familySettings, fuelEvent } from '../db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily } from '../family-scope.ts';
import type { Kitchen } from '../fridge.ts';

/**
 * Butane and pellet (#513 phase 2) on a real Postgres (PGlite), Open-Meteo faked with the same cold
 * every day: bottles bought in Dinero taken as started, how long one lasts learned, and the adults
 * told once before it runs out.
 */
const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const withFamily = familyScope(db, { role: 'app_user' });
const kitchen = (familyId: string): Kitchen => ({
	familyId,
	userId: null,
	run: (fn) => asFamily(familyId, fn)
});
mock.module('../db/index.ts', () => ({ db }));
mock.module('../family.ts', () => ({ withFamily, asFamily, NoFamily }));
mock.module('../family-settings.ts', () => ({
	familyPlace: async (k: Kitchen) =>
		(await k.run((tx) => tx.select({ place: familySettings.place }).from(familySettings)))[0]
			?.place ?? null,
	orsKey: async () => null,
	openRouterKey: async () => null
}));
const told: { familyId: string; to: string[]; title: string; body: string }[] = [];
mock.module('../inbox.ts', () => ({
	tell: async (familyId: string, to: string[], n: { title: string; body: string }) =>
		void told.push({ familyId, to, title: n.title, body: n.body })
}));
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async () => {},
	removeFile: async () => {},
	readFile: async () => null,
	listFiles: async () => [],
	fileResponse: async () => new Response()
}));
// As other tests fake it (a mock is the process's), with what these modules use of it.
mock.module('../fridge.ts', () => ({
	houseKitchen: kitchen,
	today: () => '2026-11-15',
	dayOf: (d: Date) => d.toISOString().slice(0, 10),
	toBuy: async () => [],
	addItems: async () => []
}));
mock.module('../kids.ts', () => ({ familyAdults: async () => [{ id: 'ana' }] }));
const agenda = { ...(await import('comun/agenda.ts')) };
const TODAY = '2026-11-15';
mock.module('comun/agenda.ts', () => ({ ...agenda, localDay: () => TODAY }));
const { addDays } = agenda;
const fuels = await import('./fuel.ts');

/** 10 degree-days every day (a mean of 8 °C). */
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
		{ id: 'B', name: 'Casa B' }
	]);
	const place = { name: 'Pueblo', region: null, country: null, lat: 37.6, lon: -2.1 };
	await db.insert(familySettings).values([{ familyId: 'A', place }]);
	// Bottles from the delivery man, every 12 days; and one of another family.
	for (const [familyId, date] of [
		['A', addDays(TODAY, -36)],
		['A', addDays(TODAY, -24)],
		['A', addDays(TODAY, -12)],
		['B', addDays(TODAY, -3)]
	] as const)
		await db.insert(expense).values({
			familyId,
			date,
			store: 'Butano repartidor',
			category: 'Casa',
			total: 1850,
			source: 'mano'
		});
	await db.insert(expense).values({
		familyId: 'A',
		date: addDays(TODAY, -5),
		store: 'Mercadona',
		category: 'Supermercado',
		total: 3000,
		source: 'mano'
	});
});
afterAll(() => {
	globalThis.fetch = realFetch;
});

test('butane added: its bottles in Dinero offered, none of another family', async () => {
	const k = kitchen('A');
	expect(await fuels.fuelStates(k)).toEqual([]);
	await fuels.addFuel(k, 'butano');
	await fuels.addFuel(k, 'butano');
	const [f] = await fuels.fuelStates(k);
	expect(f).toMatchObject({ kind: 'butano', startsOnBuy: true, startedOn: null, by: null });
	expect(f!.pending.map((p) => p.date)).toEqual([
		addDays(TODAY, -36),
		addDays(TODAY, -24),
		addDays(TODAY, -12)
	]);
});

test('taken: each bottle bought is one started; how long one lasts, learned; when it ends', async () => {
	const k = kitchen('A');
	const [f] = await fuels.fuelStates(k);
	for (const p of f!.pending) await fuels.boughtFuel(k, f!.id, p.date, 1, p.id);
	// Taken twice: once.
	await fuels.boughtFuel(k, f!.id, f!.pending[0]!.date, 1, f!.pending[0]!.id);
	const [now] = await fuels.fuelStates(k);
	expect(now!.pending).toEqual([]);
	expect(now!.startedOn).toBe(addDays(TODAY, -12));
	expect(now!.full).toBe(0);
	expect(now!.learnedFrom).toBe(2);
	expect(now!.by).toBe('aprendido');
	// 12 days at 10 degree-days: 1/120 a degree-day.
	expect(1 / (now!.fit!.base + now!.fit!.perDegree * 10)).toBeCloseTo(12, 6);
	// The one going, 12 days in: gone today.
	expect(now!.outlook!.left).toBeCloseTo(0, 6);
	expect(now!.outlook!.allEnds).toBe(TODAY);
});

test('told once before it runs out; again only if sooner; a new bottle starts over', async () => {
	await fuels.fuelAlerts('A');
	await fuels.fuelAlerts('A');
	expect(told).toEqual([
		{
			familyId: 'A',
			to: ['ana'],
			title: 'Butano: se acaba hoy',
			body: 'Con el frío que viene, la bombona de ahora llega hasta hoy. Llama al repartidor.'
		}
	]);
	const k = kitchen('A');
	const [f] = await fuels.fuelStates(k);
	await fuels.boughtFuel(k, f!.id, TODAY, 1);
	const [fresh] = await fuels.fuelStates(k);
	expect(fresh!.outlook!.allEnds).toBe(addDays(TODAY, 11));
	await fuels.fuelAlerts('A');
	expect(told).toHaveLength(1);
});

test('an expense that is not one: not offered again; the setting kept; pellet bought kept full', async () => {
	const k = kitchen('A');
	await fuels.addFuel(k, 'pellet');
	const states = await fuels.fuelStates(k);
	const pellet = states.find((s) => s.kind === 'pellet')!;
	expect(pellet.startsOnBuy).toBe(false);
	await fuels.boughtFuel(k, pellet.id, TODAY, 6);
	await fuels.startedFuel(k, pellet.id, TODAY);
	await fuels.saveFuel(k, pellet.id, { startsOnBuy: false, alertDays: 3, guessDays: 2 });
	const after = (await fuels.fuelStates(k)).find((s) => s.kind === 'pellet')!;
	expect(after).toMatchObject({
		full: 5,
		startedOn: TODAY,
		by: 'dicho',
		guessDays: 2,
		alertDays: 3
	});
	// 2 days a sack in winter: today's and 5 more last 12 days.
	expect(after.outlook!.allEnds).toBe(addDays(TODAY, 11));

	const butane = (await fuels.fuelStates(kitchen('A'))).find((s) => s.kind === 'butano')!;
	const [other] = await db
		.insert(expense)
		.values({
			familyId: 'A',
			date: TODAY,
			store: 'Bombona camping',
			category: 'Ocio',
			total: 900,
			source: 'mano'
		})
		.returning({ id: expense.id });
	expect((await fuels.fuelStates(k)).find((s) => s.kind === 'butano')!.pending).toHaveLength(1);
	await fuels.boughtFuel(k, butane.id, TODAY, 0, other!.id);
	expect((await fuels.fuelStates(k)).find((s) => s.kind === 'butano')!.pending).toEqual([]);
	const events = await asFamily('A', (tx) => tx.select().from(fuelEvent));
	expect(events.filter((e) => e.kind === 'descartada')).toHaveLength(1);
});
