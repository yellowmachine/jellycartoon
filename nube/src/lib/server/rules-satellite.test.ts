import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import { localDay, localTime } from 'comun/agenda.ts';
import * as schema from './db/schema.ts';
import { family, rule, user, voiceSatellite } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';
import type { RuleSpec } from '#lib/rules.ts';
import { minutesOf, momentOf } from './rule-check.ts';

/**
 * The plug rules a satellite does itself (#651, phase 3), on a real Postgres (PGlite) as the app's
 * role: Seilide does not do them too once the satellite keeps them, and what the satellite tells
 * it did is kept and told as Seilide does with its own. The plugs, the notices and the rest, faked.
 */

const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const kitchen = (familyId: string, userId: string | null): Kitchen => ({
	familyId,
	userId,
	run: (fn) => asFamily(familyId, fn)
});

class PlugOffline extends Error {}
class PlugRefused extends Error {}
const switched: { id: string; on: boolean; backAfterS?: number }[] = [];
let plugAnswer: 'ok' | 'locked' | 'offline' = 'ok';
const told: { to: string[]; title: string; body: string; url: string }[] = [];
const memories: string[] = [];

mock.module('#lib/server/plugs/hub.ts', () => ({
	PlugOffline,
	PlugRefused
}));
const pauses: { id: string; paused: boolean }[] = [];
/** «Cumple la regla N» (#651, phase 4): what the satellite was asked, and what it says. */
const asked: { id: string; rule: number }[] = [];
let satelliteSays: string | null | 'refused' = null;
mock.module('#lib/server/plugs/plugs.ts', () => ({
	askSatellite: async (_k: Kitchen, id: string, rule: number) => {
		asked.push({ id, rule });
		if (satelliteSays === 'refused') throw new PlugRefused('El satélite no lo deja: no es su hora');
		return satelliteSays;
	},
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
const sensorsNow: {
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

const { checkTimedRules, satelliteDid } = await import('./rules.ts');

const errand = (at: { day: string; time: string }) => ({
	familyId: 'A',
	userId: 'ana',
	said: 'enciende el termo una hora',
	understood: 'Encenderé «Termo» 1 hora.',
	spec: {
		when: { kind: 'en_fecha', words: [], minutesBefore: 0, time: at.time, day: at.day },
		conditions: [],
		then: 'enchufe',
		plug: { plugId: 'p1', name: 'Termo', on: true, minutes: 60 },
		notice: { to: 'yo', userIds: [], names: [], text: '', level: 'normal' },
		once: true,
		say: false
	} satisfies RuleSpec
});
const fromNow = (minutes: number) => momentOf(minutesOf(localDay(), localTime()) + minutes);
const ruleRow = async (id: number) => (await db.select().from(rule).where(eq(rule.id, id)))[0]!;

/** The satellite, offered that rule; `kept`, the version it says it keeps. */
async function satelliteWith(id: number, kept: number, ask = false) {
	await db.insert(voiceSatellite).values({
		id: 'sat',
		familyId: 'A',
		name: 'Dormitorio',
		hash: 'h',
		start: 's',
		trustFp: 'huella-del-dormitorio-x',
		plugRules: {
			version: 3,
			rules: [
				{
					id,
					when: { kind: 'en_fecha', day: localDay(), time: '00:00' },
					plug: 'shellyplugmg3-1',
					on: true,
					minutes: 60,
					once: true,
					...(ask ? { asked: true as const } : {})
				}
			]
		},
		plugRulesKept: kept
	});
}

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
	kept.length = 0;
	plugAnswer = 'ok';
	asked.length = 0;
	satelliteSays = null;
	await db.delete(rule);
	await db.delete(voiceSatellite);
});

test('Seilide does it while the satellite has not taken the list; not once it has', async () => {
	const [{ id }] = await db
		.insert(rule)
		.values(errand(fromNow(-2)))
		.returning({ id: rule.id });
	await satelliteWith(id, 2);
	await checkTimedRules('A');
	expect(switched).toHaveLength(1);

	await db.delete(rule);
	await db.delete(voiceSatellite);
	switched.length = 0;
	const [again] = await db
		.insert(rule)
		.values(errand(fromNow(-2)))
		.returning({ id: rule.id });
	await satelliteWith(again!.id, 3);
	await checkTimedRules('A');
	expect(switched).toEqual([]);
	expect((await ruleRow(again!.id)).paused).toBe(false);
});

test('what the satellite did: kept once, the errand paused, in the Buzón', async () => {
	const [{ id }] = await db
		.insert(rule)
		.values(errand(fromNow(-2)))
		.returning({ id: rule.id });
	const k = kitchen('A', null);
	const at = Date.now() - 60_000;
	expect(await satelliteDid(k, 'Dormitorio', { id, key: 'x 09:00', at })).toBe(true);
	expect(await satelliteDid(k, 'Dormitorio', { id, key: 'x 09:00', at })).toBe(false);
	const r = await ruleRow(id);
	expect(r.paused).toBe(true);
	expect(r.lastWhy).toContain('«Dormitorio»');
	expect(r.lastFiredAt?.getTime()).toBe(at);
	expect(kept).toHaveLength(1);
	expect(told).toEqual([]);
});

test('it could not: told if recent; told late (it was offline), only kept', async () => {
	const [{ id }] = await db
		.insert(rule)
		.values(errand(fromNow(-2)))
		.returning({ id: rule.id });
	const k = kitchen('A', null);
	await satelliteDid(k, 'Dormitorio', { id, key: 'a', at: Date.now(), failed: 'está en pausa' });
	expect(told).toHaveLength(1);
	expect(told[0]!.body).toContain('está en pausa');
	await satelliteDid(k, 'Dormitorio', {
		id,
		key: 'b',
		at: Date.now() - 2 * 3_600_000,
		failed: 'no está conectado'
	});
	expect(told).toHaveLength(1);
	expect((await ruleRow(id)).lastWhy).toContain('no está conectado');
});

test('asked for (phase 4): Seilide looks at it and asks its satellite, which does what was signed', async () => {
	const [{ id }] = await db
		.insert(rule)
		.values(errand(fromNow(-1)))
		.returning({ id: rule.id });
	await satelliteWith(id, 3, true);
	await checkTimedRules('A');
	expect(asked).toEqual([{ id: 'p1', rule: id }]);
	expect(switched).toEqual([]);
	expect(kept).toHaveLength(1);
	expect((await ruleRow(id)).lastWhy).toContain('encendido «Termo» 1 hora');
});

test('asked for, the satellite says no: whom it is for told why', async () => {
	const [{ id }] = await db
		.insert(rule)
		.values(errand(fromNow(-1)))
		.returning({ id: rule.id });
	await satelliteWith(id, 3, true);
	satelliteSays = 'refused';
	await checkTimedRules('A');
	expect(told).toHaveLength(1);
	expect(told[0]!.body).toContain('no lo deja su satélite (no es su hora)');
	expect(switched).toEqual([]);
});
