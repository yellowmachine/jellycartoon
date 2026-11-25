import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { expense, family, familySettings, fuelEvent, fuelUnit } from '../db/schema.ts';
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
		{ id: 'B', name: 'Casa B' },
		{ id: 'C', name: 'Casa C' }
	]);
	const place = { name: 'Pueblo', region: null, country: null, lat: 37.6, lon: -2.1 };
	await db.insert(familySettings).values([
		{ familyId: 'A', place },
		{ familyId: 'C', place }
	]);
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

const state = async (familyId: string, kind: 'butano' | 'pellet') =>
	(await fuels.fuelStates(kitchen(familyId))).find((s) => s.kind === kind)!;
const problem = (p: Promise<unknown>) =>
	p.then(
		() => null,
		(e: Error) => (e instanceof fuels.FuelProblem ? e.message : `otro: ${e.message}`)
	);

test('butane added: its bottles in Dinero offered, none of another family', async () => {
	const k = kitchen('A');
	expect(await fuels.fuelStates(k)).toEqual([]);
	await fuels.addFuel(k, 'butano');
	await fuels.addFuel(k, 'butano');
	const [f, ...rest] = await fuels.fuelStates(k);
	expect(rest).toEqual([]);
	expect(f).toMatchObject({
		kind: 'butano',
		startsOnBuy: true,
		fresh: true,
		full: 0,
		outlook: null
	});
	expect(f!.spots).toHaveLength(1);
	expect(f!.spots[0]).toMatchObject({ name: '', unit: null, by: null });
	expect(f!.pending.map((p) => p.date)).toEqual([
		addDays(TODAY, -36),
		addDays(TODAY, -24),
		addDays(TODAY, -12)
	]);
});

test('taken and put on: how long one lasts, learned; when it ends', async () => {
	const k = kitchen('A');
	const f = await state('A', 'butano');
	const spotId = f.spots[0]!.id;
	// In whatever order they are taken.
	for (const p of [f.pending[2]!, f.pending[0]!, f.pending[1]!])
		await fuels.boughtFuel(k, f.id, p.date, 1, { expenseId: p.id, use: { spotId } });
	// Taken twice: once.
	expect(
		await fuels.boughtFuel(k, f.id, f.pending[0]!.date, 1, { expenseId: f.pending[0]!.id })
	).toBeNull();
	const now = await state('A', 'butano');
	expect(now.pending).toEqual([]);
	expect(now.full).toBe(0);
	const spot = now.spots[0]!;
	expect(spot.unit!.startedOn).toBe(addDays(TODAY, -12));
	expect(spot.learnedFrom).toBe(2);
	expect(spot.by).toBe('aprendido');
	// 12 days at 10 degree-days: 1/120 a degree-day.
	expect(1 / (spot.fit!.base + spot.fit!.perDegree * 10)).toBeCloseTo(12, 6);
	// The one going, 12 days in: gone today.
	expect(spot.left).toBeCloseTo(0, 6);
	expect(now.outlook!.allEnds).toBe(TODAY);
});

test('what each cost, from its expense; a day of it, and the last price', async () => {
	const f = await state('A', 'butano');
	expect(f.spots[0]!.sums).toMatchObject({ units: 2, days: 12, priced: 2 });
	expect(f.spots[0]!.sums!.perDay).toBeCloseTo(1850 / 12, 6);
	expect(f.unitCost).toBe(1850);
	expect(f.spent).toEqual({ total: 5550, unpriced: 0 });
	expect(f.history.units.map((u) => u.perDay !== null)).toEqual([false, true, true]);
	// Written by hand, in place of its expense's; taken away, its expense's again.
	const p = f.history.purchases[0]!;
	await fuels.editPurchase(kitchen('A'), p.id, { day: p.day, quantity: 1, total: 2000 });
	expect(await state('A', 'butano')).toMatchObject({ unitCost: 2000, spent: { total: 5700 } });
	await fuels.editPurchase(kitchen('A'), p.id, { day: p.day, quantity: 1, total: null });
	expect((await state('A', 'butano')).unitCost).toBe(1850);
});

test('told once before it runs out; a new bottle starts over', async () => {
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
	const f = await state('A', 'butano');
	const done = await fuels.boughtFuel(k, f.id, TODAY, 1, { use: { spotId: f.spots[0]!.id } });
	expect(done!.text).toBe(
		'Apuntado: 1 bombona, del 15 de noviembre. Bombona empezada hoy; la anterior duró 12 días.'
	);
	expect((await state('A', 'butano')).outlook!.allEnds).toBe(addDays(TODAY, 11));
	await fuels.fuelAlerts('A');
	expect(told).toHaveLength(1);
	// Undone: as it was, the purchase too.
	await fuels.undoFuel(k, done!.undo);
	const back = await state('A', 'butano');
	expect(back.spots[0]!.unit!.startedOn).toBe(addDays(TODAY, -12));
	expect(back.history.purchases).toHaveLength(3);
	expect(back.full).toBe(0);
});

test('pellet bought kept full; pressed twice, one; the full ones put right', async () => {
	const k = kitchen('A');
	await fuels.addFuel(k, 'pellet');
	let p = await state('A', 'pellet');
	expect(p.startsOnBuy).toBe(false);
	const spotId = p.spots[0]!.id;
	await fuels.boughtFuel(k, p.id, TODAY, 6, { total: 2700 });
	const [first, second] = await Promise.all([
		problem(fuels.startedFuel(k, p.id, spotId, TODAY)),
		problem(fuels.startedFuel(k, p.id, spotId, TODAY))
	]);
	expect([first, second].filter((x) => x === null)).toHaveLength(1);
	expect([first, second].find((x) => x !== null)).toContain('Ya estaba apuntada');
	await fuels.saveSpot(k, spotId, { name: '', heats: true, guessDays: 2 });
	p = await state('A', 'pellet');
	expect(p).toMatchObject({ full: 5, fresh: false, unitCost: 450 });
	expect(p.history.units[0]!.cost).toBe(450);
	expect(p.spots[0]).toMatchObject({ by: 'dicho', guessDays: 2 });
	// 2 days a sack in winter: today's and 5 more last 12 days.
	expect(p.outlook!.allEnds).toBe(addDays(TODAY, 11));
	await fuels.saveFuel(k, p.id, { startsOnBuy: false, alertDays: 3, full: 2 });
	expect(await state('A', 'pellet')).toMatchObject({ full: 2, alertDays: 3 });
});

test('never before its purchase, nor ahead; with none noted, any day', async () => {
	const k = kitchen('B');
	await fuels.addFuel(k, 'pellet');
	const p = await state('B', 'pellet');
	const spotId = p.spots[0]!.id;
	expect(await problem(fuels.startedFuel(k, p.id, spotId, addDays(TODAY, 1)))).toContain(
		'aún no ha llegado'
	);
	await fuels.boughtFuel(k, p.id, addDays(TODAY, -5), 1);
	expect(await problem(fuels.startedFuel(k, p.id, spotId, addDays(TODAY, -6)))).toContain(
		'se compró el 10 de noviembre'
	);
	await fuels.startedFuel(k, p.id, spotId, addDays(TODAY, -4));
	const now = await state('B', 'pellet');
	const unit = now.history.units[0]!;
	expect(unit.boughtOn).toBe(addDays(TODAY, -5));
	const edit = (startedOn: string, endedOn: string | null = null) =>
		problem(fuels.editUnit(k, unit.id, { startedOn, endedOn, whole: true }));
	expect(await edit(addDays(TODAY, -6))).toContain('no puede empezar antes');
	expect(await edit(addDays(TODAY, 1))).toContain('aún no ha llegado');
	expect(await edit(addDays(TODAY, -3), addDays(TODAY, -4))).toContain('antes de empezar');
	expect(await edit(addDays(TODAY, -5))).toBeNull();
	// Nor its purchase after it, nor fewer than were put on.
	const bought = now.history.purchases[0]!;
	expect(
		await problem(
			fuels.editPurchase(k, bought.id, { day: addDays(TODAY, -4), quantity: 1, total: null })
		)
	).toContain('no pudo comprarse después');
	expect(
		await problem(fuels.editPurchase(k, bought.id, { day: bought.day, quantity: 0, total: null }))
	).toContain('se han empezado 1');
	// None left, none noted: put on, with no limit, and it takes nothing from those bought later.
	await fuels.startedFuel(k, p.id, spotId, TODAY);
	await fuels.boughtFuel(k, p.id, TODAY, 2);
	expect((await state('B', 'pellet')).full).toBe(2);
});

test('the one at home before anything was bought takes nothing from what is bought after', async () => {
	const k = kitchen('C');
	await fuels.addFuel(k, 'butano', { full: 1, startedOn: addDays(TODAY, -3) });
	let f = await state('C', 'butano');
	expect(f).toMatchObject({ full: 1, fresh: false });
	expect(f.spots[0]!.unit!.startedOn).toBe(addDays(TODAY, -3));
	await fuels.boughtFuel(k, f.id, TODAY, 2);
	f = await state('C', 'butano');
	expect(f.full).toBe(3);
	// The one that was full already may be put on any day, before that purchase.
	await fuels.startedFuel(k, f.id, f.spots[0]!.id, addDays(TODAY, -1));
	expect((await state('C', 'butano')).full).toBe(2);
});

test('put on and its expense taken after: joined, not two', async () => {
	const k = kitchen('B');
	await fuels.addFuel(k, 'butano');
	let f = await state('B', 'butano');
	const spotId = f.spots[0]!.id;
	await fuels.startedFuel(k, f.id, spotId, addDays(TODAY, -2));
	f = await state('B', 'butano');
	const [e] = f.pending;
	expect(e!.units).toHaveLength(1);
	await fuels.boughtFuel(k, f.id, e!.date, 1, {
		expenseId: e!.id,
		use: { unitId: e!.units[0]!.id }
	});
	f = await state('B', 'butano');
	expect(f.history.units).toHaveLength(1);
	expect(f.history.units[0]!.boughtOn).toBe(addDays(TODAY, -3));
	expect(f.full).toBe(0);
	// Its purchase taken away: it stays, without it; the expense, offered again.
	await fuels.removePurchase(k, f.history.purchases[0]!.id);
	f = await state('B', 'butano');
	expect(f.history.units[0]!.boughtOn).toBeNull();
	expect(f.full).toBe(0);
	expect(f.pending).toHaveLength(1);
});

test('several at once: each spot its own; run out, the days without it do not count', async () => {
	const k = kitchen('C');
	let f = await state('C', 'butano');
	const stove = f.spots[0]!.id;
	await fuels.saveSpot(k, stove, { name: 'Estufa', heats: true, guessDays: 10 });
	await fuels.addSpot(k, f.id, 'Cocina');
	expect(await problem(fuels.addSpot(k, f.id, 'cocina'))).toContain('Ya hay uno');
	f = await state('C', 'butano');
	const kitchenSpot = f.spots[1]!.id;
	await fuels.startedFuel(k, f.id, kitchenSpot, TODAY);
	f = await state('C', 'butano');
	// The stove's goes on; the cooker's is not reckoned yet.
	expect(f.spots[0]!.unit!.startedOn).toBe(addDays(TODAY, -1));
	expect(f.uncounted).toEqual(['Cocina']);
	expect(f.full).toBe(1);
	await fuels.saveSpot(k, kitchenSpot, { name: 'Cocina', heats: false, guessDays: 60 });
	f = await state('C', 'butano');
	expect(f.uncounted).toEqual([]);
	expect(f.spots[0]!.ends).toBe(addDays(TODAY, 8));
	expect(f.spots[1]!.ends).toBeNull();
	// The full one goes to the stove: 9 days and 10 more, beyond the 15.
	expect(f.outlook).toMatchObject({ allEnds: null, toBuy: 0 });

	const going = f.spots[0]!.unit!.id;
	expect(await problem(fuels.endedFuel(k, going, addDays(TODAY, -2)))).toContain('antes');
	const done = await fuels.endedFuel(k, going, TODAY);
	expect(done.text).toBe('Apuntado que se acabó hoy; duró 1 día.');
	expect((await state('C', 'butano')).spots[0]!.unit).toBeNull();
	expect(await problem(fuels.endedFuel(k, going, TODAY))).toContain('Ya estaba');
	await fuels.undoFuel(k, done.undo);
	expect((await state('C', 'butano')).spots[0]!.unit!.id).toBe(going);

	// Put away: not shown; added again with its name, back.
	await fuels.archiveSpot(k, stove);
	f = await state('C', 'butano');
	expect(f.spots.map((s) => s.name)).toEqual(['Cocina']);
	expect(f.history.units.find((u) => u.id === going)).toMatchObject({
		endedOn: TODAY,
		whole: false
	});
	expect(await problem(fuels.archiveSpot(k, kitchenSpot))).toContain('único');
	await fuels.addSpot(k, f.id, 'estufa');
	f = await state('C', 'butano');
	expect(f.spots.find((s) => s.name === 'Estufa')).toMatchObject({ id: stove, guessDays: 10 });
});

test('the history: one taken away, the one before goes on; none over another', async () => {
	const k = kitchen('A');
	const p = await state('A', 'pellet');
	const spotId = p.spots[0]!.id;
	const [first] = await db
		.select()
		.from(fuelUnit)
		.where(sql`${fuelUnit.spotId} = ${spotId}`);
	await db
		.update(fuelUnit)
		.set({ startedOn: addDays(TODAY, -6), purchaseId: null })
		.where(sql`${fuelUnit.id} = ${first!.id}`);
	const done = await fuels.startedFuel(k, p.id, spotId, TODAY);
	const now = await state('A', 'pellet');
	expect(now.history.units.map((u) => u.endedOn)).toEqual([null, TODAY]);
	expect(
		await problem(
			fuels.editUnit(k, first!.id, {
				startedOn: addDays(TODAY, -6),
				endedOn: null,
				whole: true
			})
		)
	).toContain('Se pisa');
	await fuels.removeUnit(k, done.undo.started!);
	expect((await state('A', 'pellet')).history.units.map((u) => u.endedOn)).toEqual([null]);
});

test("another family's: nothing can be touched", async () => {
	const a = await state('A', 'butano');
	const k = kitchen('B');
	const unit = a.history.units[0]!;
	expect(await problem(fuels.startedFuel(k, a.id, a.spots[0]!.id, TODAY))).toBe('Ya no está');
	expect(await problem(fuels.endedFuel(k, unit.id, TODAY))).toBe('Ya no está');
	expect(
		await problem(fuels.editUnit(k, unit.id, { startedOn: TODAY, endedOn: null, whole: true }))
	).toBe('Ya no está');
	expect(await problem(fuels.addSpot(k, a.id, 'Mía'))).toBe('Ya no está');
	// One's own fuel, another's spot.
	const mine = await state('B', 'pellet');
	expect(await problem(fuels.startedFuel(k, mine.id, a.spots[0]!.id, TODAY))).toBe('Ya no está');
	await fuels.removeUnit(k, unit.id);
	expect((await state('A', 'butano')).history.units).toHaveLength(a.history.units.length);
});

test('an expense that is not one: not offered again', async () => {
	const k = kitchen('A');
	const f = await state('A', 'butano');
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
	expect((await state('A', 'butano')).pending).toHaveLength(1);
	const done = await fuels.boughtFuel(k, f.id, TODAY, 0, { expenseId: other!.id });
	expect((await state('A', 'butano')).pending).toEqual([]);
	const events = await asFamily('A', (tx) => tx.select().from(fuelEvent));
	expect(events.filter((e) => e.kind === 'descartada')).toHaveLength(1);
	await fuels.undoFuel(k, done!.undo);
	expect((await state('A', 'butano')).pending).toHaveLength(1);
});
