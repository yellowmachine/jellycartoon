import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, inbox, rule, user } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';
import type { RuleSpec } from '#lib/rules.ts';
import type { LooksSame } from 'comun/page-notices.ts';
import type { ExpenseInput } from 'comun/expenses.ts';

/**
 * An event marked as done → an expense proposed → answered (#600), on PGlite as the app's role; what
 * the rules do not need here, and Dinero itself, faked.
 */
const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const kitchen = (familyId: string, userId: string | null): Kitchen => ({
	familyId,
	userId,
	run: (fn) => asFamily(familyId, fn)
});

mock.module('#lib/server/plugs/hub.ts', () => ({
	PlugOffline: class extends Error {},
	PlugRefused: class extends Error {}
}));
mock.module('#lib/server/plugs/plugs.ts', () => ({
	HEAT_MS: 0,
	setPausedIn: async () => ({ heats: false }),
	plugsOf: async () => [],
	switchIn: async () => true
}));
mock.module('#lib/server/plugs/sensors.ts', () => ({ sensorsIn: async () => [] }));
mock.module('#lib/server/inbox.ts', () => ({
	keepQuietly: async () => {},
	tell: async () => {}
}));
const added: { input: ExpenseInput; userId: string | null; tellsRules: boolean }[] = [];
let breaks = false;
mock.module('#lib/server/expenses/expenses.ts', () => ({
	addExpense: async (...a: unknown[]) => {
		if (breaks) throw new Error('sin base de datos');
		added.push({
			input: a[1] as ExpenseInput,
			userId: a[6] as string,
			tellsRules: a[8] as boolean
		});
		return added.length;
	}
}));
let same: LooksSame | null = null;
mock.module('#lib/server/expenses/duplicates.ts', () => ({ lookingSame: async () => same }));
mock.module('#lib/server/fridge.ts', () => ({
	// calories.ts's (#562), unused here.
	dayOf: (d: Date) => d.toISOString().slice(0, 10),
	houseKitchen: (familyId: string) => kitchen(familyId, null),
	kitchenOf: async (userId: string) => kitchen('A', userId),
	fridgeState: async () => ({ notes: [], list: { items: [] } })
}));
mock.module('#lib/server/agenda/agenda.ts', () => ({
	agendaBetween: async () => ({ occurrences: [] }),
	agendaPeople: async () => [],
	familyAccounts: async () => ['ana'],
	familyPeople: async () => [{ name: 'Ana', userId: 'ana' }],
	personOf: async () => null
}));
mock.module('#lib/server/family-settings.ts', () => ({
	familyPlace: async () => null,
	openRouterKey: async () => null
}));
mock.module('#lib/server/house.ts', () => ({
	familyHasHouse: async () => false,
	sendHouse: async () => {
		throw new Error('sin casa');
	}
}));
mock.module('#lib/server/satellites.ts', () => ({
	familySatellites: async () => [],
	sayOnSatellites: () => {}
}));
mock.module('#lib/server/memory.ts', () => ({
	listMemories: async () => [],
	remember: async () => {}
}));
mock.module('#lib/server/medication.ts', () => ({
	dosesFor: async () => [],
	listMedication: async () => []
}));
mock.module('#lib/server/trips/planned.ts', () => ({ listPlannedTrips: async () => [] }));
mock.module('#lib/server/alarms/alarms.ts', () => ({ startTimerAt: async () => 'x' }));
mock.module('#lib/server/energy/solar.ts', () => ({ solarState: async () => null }));
mock.module('#lib/server/voice/settings.ts', () => ({
	voiceSettings: async () => ({ model: 'm', quiet: null })
}));

const { onEvent, forgetDone } = await import('./rules.ts');
const { answerExpense, waitingExpenses, withdrawExpenses } = await import('./expense-proposals.ts');

const k = kitchen('A', 'ana');
const done = { eventId: 7, title: 'Peluquería', day: '2026-11-24', userId: 'ana' };
const mark = (d = done) =>
	onEvent(k, 'cita_hecha', d.title, d.userId, [], undefined, undefined, undefined, d);

const spec: RuleSpec = {
	when: { kind: 'cita_hecha', words: ['peluquería'], minutesBefore: 0, time: null },
	conditions: [],
	then: 'gasto',
	expense: { total: 1000, store: 'Peluquería', category: 'Otros' },
	notice: { to: 'yo', userIds: [], names: [], text: '', level: 'normal' },
	once: false,
	say: false
};
const newRule = async (over: Partial<RuleSpec> = {}) =>
	(
		await db
			.insert(rule)
			.values({
				familyId: 'A',
				userId: 'pepe',
				said: 'x',
				understood: 'x',
				spec: { ...spec, ...over }
			})
			.returning({ id: rule.id })
	)[0]!.id;

const form = (fields: Record<string, string | number>) => {
	const f = new FormData();
	for (const [key, value] of Object.entries(fields)) f.set(key, String(value));
	return f;
};
const yes = (id: number) => ({
	id,
	keep: 'true',
	date: '2026-11-24',
	price: '12,00',
	store: 'Peluquería Ana',
	category: 'Otros'
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
	await db.insert(user).values(
		['ana', 'pepe'].map((id) => ({
			id,
			name: id,
			email: `${id}@test.es`,
			createdAt: new Date(),
			updatedAt: new Date()
		}))
	);
});

beforeEach(async () => {
	added.length = 0;
	same = null;
	breaks = false;
	await db.delete(inbox);
	await db.delete(rule);
});

test('proposed to who marked it, once for that day, and nothing in Dinero yet', async () => {
	await newRule();
	await mark();
	await mark();
	await mark({ ...done, title: 'Dentista', eventId: 8 });
	const waiting = await waitingExpenses(k, 'ana');
	expect(waiting).toHaveLength(1);
	expect(waiting[0]!.proposal).toMatchObject({ eventId: 7, day: '2026-11-24', total: 1000 });
	expect(await waitingExpenses(k, 'pepe')).toEqual([]);
	expect(added).toEqual([]);
	// Another repetition of it: again.
	await mark({ ...done, day: '2026-12-24' });
	expect(await waitingExpenses(k, 'ana')).toHaveLength(2);
});

test('«Añadir», as changed, once, and without setting off other rules', async () => {
	await newRule();
	await mark();
	const { id } = (await waitingExpenses(k, 'ana'))[0]!;
	// Not another person's to answer.
	expect(await answerExpense(k, 'pepe', form(yes(id)))).toMatchObject({ status: 404 });
	expect(await answerExpense(k, 'ana', form({ ...yes(id), price: '0' }))).toMatchObject({
		status: 400
	});
	expect(await answerExpense(k, 'ana', form(yes(id)))).toEqual({ expense: 1, month: '2026-11' });
	expect(await answerExpense(k, 'ana', form(yes(id)))).toMatchObject({ status: 404 });
	expect(added).toEqual([
		{
			input: {
				date: '2026-11-24',
				store: 'Peluquería Ana',
				category: 'Otros',
				total: 1200,
				lines: []
			},
			userId: 'ana',
			tellsRules: false
		}
	]);
	// Answered: unmarked and marked again, not proposed twice.
	expect(await withdrawExpenses(k, 7, '2026-11-24')).toEqual([]);
	await mark();
	expect(await waitingExpenses(k, 'ana')).toEqual([]);
});

test('looks the same as one there: said before, and asked; «No», nothing', async () => {
	await newRule();
	same = { id: 3, date: '2026-11-24', store: 'PELUQUERIA', total: 1000, by: 'dia' };
	await mark();
	const [waiting] = await waitingExpenses(k, 'ana');
	expect(waiting!.repeated).toEqual(same);
	expect(await answerExpense(k, 'ana', form(yes(waiting!.id)))).toMatchObject({ status: 409 });
	await answerExpense(k, 'ana', form({ id: waiting!.id, keep: 'false' }));
	expect(await waitingExpenses(k, 'ana')).toEqual([]);
	expect(added).toEqual([]);
});

test('no longer done: withdrawn, and proposed again if marked again', async () => {
	const id = await newRule({ once: true });
	await mark();
	const rules = await withdrawExpenses(k, 7, '2026-11-24');
	expect(rules).toEqual([id]);
	expect(await waitingExpenses(k, 'ana')).toEqual([]);
	await forgetDone(k, rules, done);
	expect((await db.select().from(rule).where(eq(rule.id, id)))[0]!.paused).toBe(false);
	await mark();
	expect(await waitingExpenses(k, 'ana')).toHaveLength(1);
});

test('not saved, still waiting; after 30 days, gone', async () => {
	await newRule();
	await mark();
	const { id } = (await waitingExpenses(k, 'ana'))[0]!;
	breaks = true;
	await expect(answerExpense(k, 'ana', form(yes(id)))).rejects.toThrow();
	expect(await waitingExpenses(k, 'ana')).toHaveLength(1);
	await db.update(inbox).set({ createdAt: sql`now() - interval '31 days'` });
	expect(await waitingExpenses(k, 'ana')).toEqual([]);
});
