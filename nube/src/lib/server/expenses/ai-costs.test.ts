import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { addDays, localDay, mondayOf } from 'comun/agenda.ts';
import * as schema from '#lib/server/db/schema.ts';
import { aiCost, family } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/** Gastos → IA's sums, on a real Postgres (PGlite, in memory) with the migrations as they are. */
const db = drizzle(new PGlite(), { schema });
/** As the app's role (`nube_app` in production), to whom row-level security applies. */
const k: Kitchen = {
	familyId: 'A',
	userId: null,
	run: (fn) =>
		db.transaction(async (tx) => {
			await tx.execute(sql`set local role app_user`);
			await tx.execute(sql`select set_config('app.family_id', 'A', true)`);
			return fn(tx);
		})
};
// Bun's module mocks are the whole run's: the same as search.test.ts's.
mock.module('#lib/server/fridge.ts', () => ({
	houseKitchen: () => k,
	today: localDay, // chat.test.ts's, unused here: a mock's names are fixed by the first one.
	toBuy: async () => [],
	addItems: async () => []
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => 'clave' }));
mock.module('#lib/server/openrouter-usage.ts', () => ({
	keyUsage: async () => ({ total: 9, month: 2, week: 1 })
}));
const { addAiCost, aiCostStats, describeAiSpending, unnoted } = await import('./ai-costs.ts');

// A fixed day and hour, whenever it runs: «today» here must not change halfway through at midnight.
setSystemTime(new Date(2026, 10, 11, 12, 0));
afterAll(() => void setSystemTime());

const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`);
const today = localDay();
const lastWeek = addDays(mondayOf(today), -3);

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
	const row = (familyId: string, kind: string, cost: number, when: Date, app = 'nube') => ({
		familyId,
		app,
		kind,
		label: kind,
		cost,
		at: when
	});
	await db
		.insert(aiCost)
		.values([
			row('A', 'Voz', 0.01, at(today)),
			row('A', 'Voz', 0.03, at(today, 13)),
			row('A', 'Tickets', 0.05, at(today), 'nube'),
			row('A', 'Cine: sinopsis', 0.002, at(lastWeek), 'casa'),
			row('A', 'Voz', 1, at('2020-01-15')),
			row('B', 'Voz', 9, at(today))
		]);
});

describe('Gastos → IA', () => {
	test('this week, this month and all, only the family’s', async () => {
		const s = await aiCostStats(k);
		expect(s.week).toBeCloseTo(0.09);
		expect(s.total).toBeCloseTo(1.092);
		expect(s.count).toBe(5);
		expect(s.months).toHaveLength(12);
		expect(s.months.at(-1)!.month).toBe(today.slice(0, 7));
		expect(s.weeks).toHaveLength(8);
		expect(s.weeks.at(-1)!.week).toBe(mondayOf(today));
		expect(s.weeks.at(-2)!.cost).toBeCloseTo(0.002);
	});

	test('by kind, the dearest first; the last ones, the newest first', async () => {
		const s = await aiCostStats(k);
		expect(s.kinds.all[0]).toMatchObject({ kind: 'Voz', count: 3 });
		expect(s.kinds.all[0]!.cost).toBeCloseTo(1.04);
		expect(s.kinds.month.map((r) => r.kind)).toContain('Tickets');
		expect(s.kinds.month.find((r) => r.kind === 'Voz')!.cost).toBeCloseTo(0.04);
		expect(s.recent[0]!.cost).toBe(0.03);
		expect(s.recent.every((r) => r.cost < 9)).toBe(true);
	});
});

describe('the house’s, sent again', () => {
	test('one with the same id is counted once; without one, each', async () => {
		const ref = 'b1946ac9-2f5d-4c5e-9a7e-1f0d3c2b4a59';
		await addAiCost('A', 'casa', 'Voz', 0.5, at(today), ref);
		await addAiCost('A', 'casa', 'Voz', 0.5, at(today), ref);
		await addAiCost('A', 'casa', 'Voz', 0.25, at(today));
		await addAiCost('A', 'casa', 'Voz', 0.25, at(today));
		const s = await aiCostStats(k);
		expect(s.count).toBe(8);
		expect(s.total).toBeCloseTo(2.092);
	});
});

describe('those noted as «Otros»', () => {
	test('by their label now, together with the ones already named', async () => {
		const otros = (label: string, cost: number) => ({
			familyId: 'A',
			app: 'nube',
			kind: 'Otros',
			label,
			cost,
			at: at(today, 14)
		});
		await db
			.insert(aiCost)
			.values([otros('Preguntar', 0.2), otros('Preguntar', 0.1), otros('Cosa rara', 0.01)]);
		await addAiCost('A', 'nube', 'Preguntar', 0.1, at(today, 15));
		const s = await aiCostStats(k);
		const asked = s.kinds.month.find((r) => r.kind === 'Preguntar')!;
		expect(asked.count).toBe(3);
		expect(asked.cost).toBeCloseTo(0.4);
		expect(s.kinds.month.find((r) => r.kind === 'Otros')!.cost).toBeCloseTo(0.01);
		expect(s.recent.filter((r) => r.label === 'Preguntar').map((r) => r.kind)).toEqual([
			'Preguntar',
			'Preguntar',
			'Preguntar'
		]);
	});

	test('what Preguntar is told, with what is not noted', async () => {
		const said = await describeAiSpending(k);
		expect(said).toContain('Preguntar 0,400 $ (3 veces)');
		expect(said).toContain('sin apuntar');
		expect(said).not.toContain('9,00');
	});
});

test('what is not noted: only known from before the month, and more than a trifle', () => {
	const since = '2020-01-01T10:00:00Z';
	expect(unnoted({ month: 1, since }, 1.5)).toBeCloseTo(0.5);
	expect(unnoted({ month: 1, since }, 1.005)).toBeNull();
	expect(unnoted({ month: 2, since }, 1.5)).toBeNull();
	expect(unnoted({ month: 1, since }, null)).toBeNull();
	expect(
		unnoted({ month: 1, since: at(addDays(`${today.slice(0, 7)}-01`, 4)).toISOString() }, 2)
	).toBeNull();
});
