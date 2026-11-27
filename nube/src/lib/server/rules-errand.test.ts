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
const told: { to: string[]; title: string; body: string; url: string }[] = [];
const memories: string[] = [];

mock.module('#lib/server/plugs/hub.ts', () => ({
	PlugOffline,
	PlugRefused: class extends Error {}
}));
const pauses: { id: string; paused: boolean }[] = [];
mock.module('#lib/server/plugs/plugs.ts', () => ({
	HEAT_MS: 4 * 3_600_000,
	setPausedIn: async (_k: Kitchen, id: string, paused: boolean) => {
		if (plugAnswer === 'locked') return { heats: false, locked: true };
		pauses.push({ id, paused });
		return { heats: !paused };
	},
	plugsOf: async () => [],
	switchIn: async (_k: Kitchen, id: string, on: boolean, backAfterS?: number) => {
		if (plugAnswer === 'offline') throw new PlugOffline('sin conexión');
		if (plugAnswer === 'locked') return 'locked';
		switched.push({ id, on, ...(backAfterS ? { backAfterS } : {}) });
		return true;
	}
}));
/** The family's sensors as they read now (#508), faked: the last reading and when. */
let sensorsNow: {
	id: string;
	name: string;
	home: boolean;
	tempC: number | null;
	at: string | null;
}[] = [];
mock.module('#lib/server/plugs/sensors.ts', () => ({
	sensorsIn: async () => sensorsNow
}));
/** In the Buzón only, without the phone (#557, phase 3). */
const kept: { to: string[]; title: string; body: string }[] = [];
mock.module('#lib/server/inbox.ts', () => ({
	keepQuietly: async (_f: string, to: string[], n: { title: string; body: string }) => {
		kept.push({ to, title: n.title, body: n.body });
	},
	tell: async (_f: string, to: string[], n: { title: string; body: string; url: string }) => {
		told.push({ to, title: n.title, body: n.body, url: n.url });
	}
}));
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

const { checkTimedRules, listErrands, moveErrand } = await import('./rules.ts');

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
	pauses.length = 0;
	told.length = 0;
	kept.length = 0;
	memories.length = 0;
	plugAnswer = 'ok';
	sensorsNow = [];
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
			body: expect.stringMatching(
				/^«Termo» tiene el candado puesto\. Era para: El .+ a las \d\d:\d\d: encenderé «Termo» 1 hora\.$/
			),
			url: '/reglas?ver=encargos'
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

const COLD_AT_HOME: RuleSpec['conditions'] = [
	{
		kind: 'temperatura',
		words: [],
		negate: false,
		temperature: { sensorId: null, name: null, below: true, degrees: 15 }
	}
];
const readAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

test('«si en casa hay menos de 15 grados» (#557): a recent reading under it switches the plug', async () => {
	sensorsNow = [{ id: 's1', name: 'Salón', home: true, tempC: 13.2, at: readAgo(25) }];
	const [{ id }] = await db
		.insert(rule)
		.values(errand(fromNow(-1), COLD_AT_HOME))
		.returning({ id: rule.id });
	await checkTimedRules('A');
	expect(switched).toEqual([{ id: 'p1', on: true, backAfterS: 3600 }]);
	expect((await ruleRow(id)).lastWhy).toContain('en casa hay 13,2 °C, menos de 15 °C');
});

test('a reading too old (#557): not switched, and when its hour is over, told to do it by hand', async () => {
	sensorsNow = [{ id: 's1', name: 'Salón', home: true, tempC: 13.2, at: readAgo(4 * 60) }];
	const [{ id }] = await db
		.insert(rule)
		.values(errand(fromNow(-3), COLD_AT_HOME))
		.returning({ id: rule.id });
	await checkTimedRules('A');
	expect(switched).toEqual([]);
	expect(told).toEqual([]);
	expect((await ruleRow(id)).lastWhy).toStartWith('sin saber: no sé la temperatura de casa');

	await db.delete(rule);
	await db.insert(rule).values({
		...errand(fromNow(-90), COLD_AT_HOME),
		lastWhy: 'sin saber: no sé la temperatura de casa: la última lectura de «Salón» es de hace 4 h'
	});
	await checkTimedRules('A');
	expect(switched).toEqual([]);
	expect(told).toEqual([
		{
			to: ['ana'],
			title: '🔌 No he encendido «Termo»',
			body: expect.stringMatching(
				/^No sé la temperatura de casa: la última lectura de «Salón» es de hace 4 h\. Era para: El .+: encenderé «Termo» 1 hora\. Si quieres, hazlo desde Enchufes\.$/
			),
			url: '/enchufes'
		}
	]);
});

test('warm enough (#557): not switched, and its hour over, paused quietly with why', async () => {
	sensorsNow = [{ id: 's1', name: 'Salón', home: true, tempC: 17, at: readAgo(10) }];
	await db.insert(rule).values(errand(fromNow(-2), COLD_AT_HOME));
	await checkTimedRules('A');
	expect(switched).toEqual([]);
	const [row] = await db.select().from(rule);
	expect(row!.lastWhy).toBe('no se cumple: en casa hay 17 °C, no menos de 15 °C');
	await db.update(rule).set({ spec: errand(fromNow(-90), COLD_AT_HOME).spec });
	await checkTimedRules('A');
	const [after] = await db.select().from(rule);
	expect(after!.paused).toBe(true);
	expect(after!.lastWhy).toBe('en casa hay 17 °C, no menos de 15 °C');
	expect(told).toEqual([]);
});

test('what it did and what did not hold (#557, phase 3): in the Buzón, quietly; with its day first', async () => {
	await db.insert(rule).values(errand(fromNow(-1)));
	await checkTimedRules('A');
	expect(told).toEqual([]);
	expect(kept).toEqual([
		{
			to: ['ana'],
			title: '🔌 Encendido «Termo» 1 hora',
			body: expect.stringMatching(
				/^Porque son las .+\. Era para: El .+ a las \d\d:\d\d: encenderé «Termo» 1 hora\.$/
			)
		}
	]);
	kept.length = 0;
	await db.delete(rule);
	await db.insert(rule).values({
		...errand(fromNow(-90), COLD_AT_HOME),
		lastWhy: 'no se cumple: en casa hay 17 °C, no menos de 15 °C'
	});
	await checkTimedRules('A');
	expect(told).toEqual([]);
	expect(kept).toMatchObject([
		{
			title: '🔌 No he encendido «Termo»',
			body: expect.stringMatching(/^En casa hay 17 °C, no menos de 15 °C\. Era para: /)
		}
	]);
});

test('listed and moved (#557, phase 3): by their moment; moved, waiting afresh; a past moment refused', async () => {
	const ana = kitchen('A', 'ana');
	const later = fromNow(120);
	const sooner = fromNow(30);
	const [{ id: a }] = await db.insert(rule).values(errand(later)).returning({ id: rule.id });
	const [{ id: b }] = await db.insert(rule).values(errand(sooner)).returning({ id: rule.id });
	const [{ id: done }] = await db
		.insert(rule)
		.values({ ...errand(fromNow(-200)), paused: true, lastWhy: 'x', lastFiredAt: new Date() })
		.returning({ id: rule.id });
	// A rule that stays is no errand.
	await db.insert(rule).values({
		...errand(later),
		spec: {
			...errand(later).spec,
			when: { kind: 'cada_dia', words: [], minutesBefore: 0, time: '09:00' }
		}
	});
	let list = await listErrands(ana, 'ana');
	expect(list.coming.map((r) => r.id)).toEqual([b, a]);
	expect(list.past.map((r) => r.id)).toEqual([done]);
	// Another person of the family does not see hers.
	expect((await listErrands(kitchen('A', 'otro'), 'otro')).coming).toEqual([]);

	expect(await moveErrand(ana, 'ana', a, fromNow(-5).day, fromNow(-5).time)).toBe(
		'Esa hora ya ha pasado.'
	);
	expect(await moveErrand(ana, 'ana', a, 'mañana', '08:00')).toContain('Falta');
	expect(await moveErrand(ana, 'otro', a, later.day, later.time)).toBe('No hay ese encargo.');
	const soon = fromNow(10);
	expect(await moveErrand(ana, 'ana', done, soon.day, soon.time)).toBeNull();
	const again = await ruleRow(done);
	expect(again).toMatchObject({ paused: false, lastWhy: null, lastFiredAt: null, fired: [] });
	expect(again.spec.when).toMatchObject({ day: soon.day, time: soon.time });
	list = await listErrands(ana, 'ana');
	expect(list.coming.map((r) => r.id)).toEqual([done, b, a]);
});

test('past errands go after a week, the ones to come stay (#557, phase 3)', async () => {
	const old = momentOf(minutesOf(localDay(), '12:00') - 8 * 24 * 60);
	const recent = momentOf(minutesOf(localDay(), '12:00') - 2 * 24 * 60);
	await db
		.insert(rule)
		.values([
			{ ...errand(old), paused: true, lastWhy: 'x' },
			{ ...errand(recent), paused: true, lastWhy: 'y' },
			errand(fromNow(60))
		]);
	await checkTimedRules('A');
	const left = await db.select({ lastWhy: rule.lastWhy, paused: rule.paused }).from(rule);
	expect(left.map((r) => r.lastWhy).sort()).toEqual([null, 'y']);
});

test('an errand that pauses (#557): its pause put, or taken off with the long heat said; the padlock told', async () => {
	const pausing = (paused: boolean) => {
		const e = errand(fromNow(-1));
		return {
			...e,
			spec: { ...e.spec, plug: { ...e.spec.plug, on: false, minutes: null, pause: paused } }
		};
	};
	const [{ id }] = await db.insert(rule).values(pausing(true)).returning({ id: rule.id });
	await checkTimedRules('A');
	expect(pauses).toEqual([{ id: 'p1', paused: true }]);
	expect(switched).toEqual([]);
	expect((await ruleRow(id)).lastWhy).toMatch(/: puesto en pausa «Termo»$/);
	expect(kept.at(-1)?.title).toBe('🔌 Puesto en pausa «Termo»');

	await db.delete(rule);
	const [{ id: back }] = await db.insert(rule).values(pausing(false)).returning({ id: rule.id });
	await checkTimedRules('A');
	expect((await ruleRow(back)).lastWhy).toMatch(
		/: quitado la pausa de «Termo», y calienta 4 horas seguidas contra la legionela$/
	);

	await db.delete(rule);
	plugAnswer = 'locked';
	await db.insert(rule).values(pausing(true));
	await checkTimedRules('A');
	expect(told.at(-1)).toMatchObject({
		title: '🔌 No he podido poner en pausa «Termo»',
		body: expect.stringMatching(/^«Termo» tiene el candado puesto\./)
	});
});
