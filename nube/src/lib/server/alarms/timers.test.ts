import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '#lib/server/db/schema.ts';
import { alarm, family, familyPerson } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * The timers said to the cloud, on a real Postgres (PGlite, in memory) with the migrations as they
 * are: what the house and the phones are told, faked.
 */
const house: { path: string; body: { place: string } }[] = [];
const notices: { title: string; body: string }[] = [];
mock.module('#lib/server/house.ts', () => ({
	tellHouse: async (_: string, path: string, body: { place: string }) => {
		house.push({ path, body });
		return { where: 'toda la casa' };
	},
	familyHasHouse: async () => true,
	// homework.test.ts's, unused here: a mock is the whole process's.
	askHouse: async () => ({}),
	HouseProblem: class extends Error {}
}));
// One satellite served by Seilide (#296), already connected: its alarms ring here, not at the house.
mock.module('#lib/server/satellites.ts', () => ({
	familySatellites: async () => [{ id: 'dormitorio', name: 'dormitorio' }],
	servedSatellites: async () => [{ id: 'dormitorio', name: 'dormitorio' }],
	satellitesChanged: async () => {}
}));
mock.module('#lib/server/push.ts', () => ({
	notify: async (_: string, __: unknown, notice: { title: string; body: string }) =>
		void notices.push(notice)
}));
// Their inbox (#331) tells the phones: faked as they are.
mock.module('#lib/server/inbox.ts', () => ({
	tell: async (_: string, __: unknown, notice: { title: string; body: string }) =>
		void notices.push(notice)
}));
mock.module('#lib/server/telegram/bot.ts', () => ({ tellGroup: async () => {} }));
mock.module('#lib/server/agenda/agenda.ts', () => ({ toldOf: async () => [] }));

const {
	cancelTimers,
	describeTimersOf,
	listAlarms,
	ringDue,
	ringingFor,
	startTimer,
	startTimerAt
} = await import('./alarms.ts');

const db = drizzle(new PGlite(), { schema });
const k: Kitchen = { familyId: 'A', userId: null, run: (fn) => db.transaction((tx) => fn(tx)) };
let me = '';

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
	const [p] = await db
		.insert(familyPerson)
		.values({ familyId: 'A', name: 'Ana' })
		.returning({ id: familyPerson.id });
	me = String(p!.id);
});

/** As if its end had come. */
const due = (label: string) =>
	db
		.update(alarm)
		.set({ nextAt: new Date(Date.now() - 1000) })
		.where(eq(alarm.label, label));

describe('timers said to the cloud', () => {
	test('on the phone: a notice, and the house is not told', async () => {
		expect(await startTimer(k, me, { label: 'la pasta', seconds: 540, place: 'movil' })).toBe(
			'la pasta'
		);
		expect((await describeTimersOf(k, me))[0]).toMatch(/^la pasta, quedan (8 min 5\d s|9 min)$/);
		const [shown] = await listAlarms(k, me);
		expect(shown).toMatchObject({ kind: 'temporizador', place: 'movil' });
		await due('la pasta');
		await ringDue(k);
		await Bun.sleep(10);
		expect(house).toEqual([]);
		expect(notices.at(-1)).toMatchObject({ title: '⏲️ la pasta', body: 'Sonando en el móvil' });
		expect(await describeTimersOf(k, me)).toEqual(['la pasta, ya ha terminado y está sonando']);
	});

	test('the same name starts over; without one, by its time', async () => {
		await startTimer(k, me, { label: 'la pasta', seconds: 60, place: 'movil' });
		expect(await startTimer(k, me, { label: '', seconds: 300, place: 'movil' })).toBe('5 minutos');
		expect(await startTimer(k, me, { label: 'temporizador', seconds: 300, place: 'movil' })).toBe(
			'5 minutos (2)'
		);
		const timers = await describeTimersOf(k, me);
		expect(timers.filter((t) => t.startsWith('la pasta'))).toHaveLength(1);
		expect(timers).toHaveLength(3);
	});

	test('«en casa»: the house rings it', async () => {
		await startTimer(k, me, { label: 'el horno', seconds: 1200, place: 'casa' });
		expect(await describeTimersOf(k, me)).toContain(
			'el horno (suena en toda la casa), quedan 20 min'
		);
		await due('el horno');
		await ringDue(k);
		await Bun.sleep(10);
		expect(house.at(-1)).toMatchObject({ path: '/avisos', body: { place: 'casa' } });
	});

	test('taken away: told as such, and never rings', async () => {
		expect(await cancelTimers(k, me, '5 MINUTOS')).toBe(1);
		expect(await describeTimersOf(k, me)).toContainEqual(
			expect.stringMatching(/^5 minutos, ya se quitó hace/)
		);
		expect(await cancelTimers(k, me, null)).toBe(3);
		const rings = notices.length;
		await ringDue(k);
		expect(notices).toHaveLength(rings);
		expect(await listAlarms(k, me)).toEqual([]);
	});

	test('not for the house: a satellite does not see them', async () => {
		await startTimer(k, me, { label: 'el pan', seconds: 60, place: 'movil' });
		expect(await listAlarms(k, null)).toEqual([]);
	});
});

describe('the satellites Seilide serves (#296)', () => {
	test('their timer rings there, heard by them, and the house is not told', async () => {
		const before = house.length;
		await startTimerAt(k, 'satelite:dormitorio', { label: 'la siesta', seconds: 600 });
		await due('la siesta');
		await ringDue(k);
		expect(await ringingFor(k, 'dormitorio')).toEqual({
			ringing: ['la siesta'],
			play: ['la siesta']
		});
		expect(house.length).toBe(before);
	});
});
