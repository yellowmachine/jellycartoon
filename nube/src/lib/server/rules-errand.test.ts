import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import { localDay, localTime } from 'comun/agenda.ts';
import * as schema from './db/schema.ts';
import { family, rule, user } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';
import type { RuleSpec } from '#lib/rules.ts';
import { minutesOf, momentOf } from './rule-check.ts';

/**
 * An errand (#557) as the server does it, every minute, on a real Postgres (PGlite) as the app's
 * role: at its time, its plug switched with the plug's own timer, once, and kept why; a plug that
 * cannot (its padlock, not connected), whom it is for told; its moment gone by without holding,
 * paused for good with why. The plugs, the notices and the rest of the family's world, faked.
 */

const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const kitchen = (familyId: string, userId: string | null): Kitchen => ({
	familyId,
	userId,
	run: (fn) => asFamily(familyId, fn)
});

class PlugOffline extends Error {}
const switched: { id: string; on: boolean; backAfterS?: number }[] = [];
let plugAnswer: 'ok' | 'locked' | 'offline' = 'ok';
const told: { to: string[]; title: string; body: string }[] = [];
const memories: string[] = [];

mock.module('#lib/server/plugs/hub.ts', () => ({ PlugOffline }));
mock.module('#lib/server/plugs/plugs.ts', () => ({
	plugsOf: async () => [],
	switchIn: async (_k: Kitchen, id: string, on: boolean, backAfterS?: number) => {
		if (plugAnswer === 'offline') throw new PlugOffline('sin conexión');
		if (plugAnswer === 'locked') return 'locked';
		switched.push({ id, on, ...(backAfterS ? { backAfterS } : {}) });
		return true;
	}
}));
mock.module('#lib/server/inbox.ts', () => ({
	tell: async (_f: string, to: string[], n: { title: string; body: string }) => {
		told.push({ to, title: n.title, body: n.body });
	}
}));
mock.module('#lib/server/fridge.ts', () => ({
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
	listMemories: async () => memories.map((text) => ({ text })),
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

const { checkTimedRules } = await import('./rules.ts');

/** `minutes` from now on the wall's clock (negative, ago): its day and time. */
const fromNow = (minutes: number) => momentOf(minutesOf(localDay(), localTime()) + minutes);

const errand = (at: { day: string; time: string }, conditions: RuleSpec['conditions'] = []) => ({
	familyId: 'A',
	userId: 'ana',
	said: 'enciende el termo una hora',
	understood: 'Encenderé «Termo» 1 hora.',
	spec: {
		when: { kind: 'en_fecha', words: [], minutesBefore: 0, time: at.time, day: at.day },
		conditions,
		then: 'enchufe',
		plug: { plugId: 'p1', name: 'Termo', on: true, minutes: 60 },
		notice: { to: 'yo', userIds: [], names: [], text: '', level: 'normal' },
		once: true,
		say: false
	} satisfies RuleSpec
});

const ruleRow = async (id: number) => (await db.select().from(rule).where(eq(rule.id, id)))[0]!;

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
	await db.insert(user).values({
		id: 'ana',
		name: 'Ana',
		email: 'ana@test.es',
		createdAt: new Date(),
		updatedAt: new Date()
	});
});

beforeEach(async () => {
	switched.length = 0;
	told.length = 0;
	memories.length = 0;
	plugAnswer = 'ok';
	await db.delete(rule);
});

test('at its time: the plug on for an hour with its own timer, once, and why kept', async () => {
	const [{ id }] = await db
		.insert(rule)
		.values(errand(fromNow(-2)))
		.returning({ id: rule.id });
	const [{ id: later }] = await db
		.insert(rule)
		.values(errand(fromNow(30)))
		.returning({ id: rule.id });
	await checkTimedRules('A');
	await checkTimedRules('A');
	expect(switched).toEqual([{ id: 'p1', on: true, backAfterS: 3600 }]);
	const done = await ruleRow(id);
	expect(done.paused).toBe(true);
	expect(done.lastFiredAt).not.toBeNull();
	expect(done.lastWhy).toMatch(/^son las \d\d:\d\d del .+: encendido «Termo» 1 hora$/);
	expect(told).toEqual([]);
	// The one to come, untouched.
	expect((await ruleRow(later)).paused).toBe(false);
});

test('a plug that cannot: whom it is for told why, and kept so', async () => {
	plugAnswer = 'locked';
	const [{ id }] = await db
		.insert(rule)
		.values(errand(fromNow(-1)))
		.returning({ id: rule.id });
	await checkTimedRules('A');
	expect(told).toEqual([
		{
			to: ['ana'],
			title: '🔌 No he podido encender «Termo»',
			body: '«Termo» tiene el candado puesto. Era para: Encenderé «Termo» 1 hora.'
		}
	]);
	expect((await ruleRow(id)).lastWhy).toContain(
		'pero no he podido: «Termo» tiene el candado puesto'
	);

	plugAnswer = 'offline';
	await db.delete(rule);
	await db.insert(rule).values(errand(fromNow(-1)));
	await checkTimedRules('A');
	expect(told.at(-1)?.body).toStartWith('«Termo» no está conectado.');
});

test('a condition that does not hold: tried again within the hour, then paused for good with why', async () => {
	const [{ id }] = await db
		.insert(rule)
		.values(errand(fromNow(-5), [{ kind: 'recuerdo', words: ['frio'], negate: false }]))
		.returning({ id: rule.id });
	await checkTimedRules('A');
	expect(switched).toEqual([]);
	let row = await ruleRow(id);
	expect(row.paused).toBe(false);
	expect(row.lastWhy).toBe('no se cumple: no recuerdo nada con «frio»');
	// It comes to hold within its hour: done then.
	memories.push('Hace frío en casa');
	await checkTimedRules('A');
	expect(switched).toHaveLength(1);

	// Gone by more than an hour without holding.
	await db.delete(rule);
	memories.length = 0;
	const [{ id: missed }] = await db
		.insert(rule)
		.values({
			...errand(fromNow(-90), [{ kind: 'recuerdo', words: ['frio'], negate: false }]),
			lastWhy: 'no se cumple: no recuerdo nada con «frio»'
		})
		.returning({ id: rule.id });
	await checkTimedRules('A');
	row = await ruleRow(missed);
	expect(row.paused).toBe(true);
	expect(row.lastFiredAt).toBeNull();
	expect(row.lastWhy).toBe('no recuerdo nada con «frio»');
	expect(switched).toHaveLength(1);
});
