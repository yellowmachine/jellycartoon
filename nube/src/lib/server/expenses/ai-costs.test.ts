import { beforeAll, describe, expect, mock, test } from 'bun:test';
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
mock.module('#lib/server/fridge.ts', () => ({ houseKitchen: () => k }));
const { aiCostStats } = await import('./ai-costs.ts');

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
