import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { alarm, family, voiceSatellite } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';
import { newSatelliteKey, satelliteKeyScope } from './satellite-key-scope.ts';

// Its clock's neighbours, faked: no house, no phones, no Telegram.
mock.module('#lib/server/house.ts', () => ({
	tellHouse: async () => ({ where: '' }),
	familyHasHouse: async () => false,
	// homework.test.ts's, unused here: a mock is the whole process's.
	askHouse: async () => ({}),
	HouseProblem: class extends Error {}
}));
mock.module('#lib/server/satellites.ts', () => ({
	familySatellites: async () => [],
	servedSatellites: async () => []
}));
mock.module('#lib/server/push.ts', () => ({ notify: async () => {} }));
// Their inbox (#331) tells the phones: faked as they are.
mock.module('#lib/server/inbox.ts', () => ({ tell: async () => {} }));
mock.module('#lib/server/telegram/bot.ts', () => ({ tellGroup: async () => {} }));
mock.module('#lib/server/agenda/agenda.ts', () => ({ toldOf: async () => [] }));

const { cancelTimersAt, describeTimersAt, ringingFor, startTimerAt, stopRingingAt } =
	await import('./alarms/alarms.ts');

/**
 * The satellites Seilide serves (#296), on a real Postgres (PGlite) as the app's role: a key finds
 * its satellite and nothing else; its timers are kept at its place, ring there, and its wake word
 * stops them.
 */
const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const satelliteOfKey = satelliteKeyScope(db, { role: 'app_user' });
const house = (familyId: string): Kitchen => ({
	familyId,
	userId: null,
	run: (fn) => asFamily(familyId, (tx) => fn(tx))
});

const keyA = newSatelliteKey();
const keyB = newSatelliteKey();

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(voiceSatellite).values([
		{ id: 'dormitorio', familyId: 'A', name: 'dormitorio', hash: keyA.hash, start: keyA.start },
		{ id: 'cocina', familyId: 'B', name: 'cocina', hash: keyB.hash, start: keyB.start }
	]);
});

describe('satellite keys', () => {
	test('its own satellite, and when it was heard from', async () => {
		expect(await satelliteOfKey(keyA.key)).toEqual({
			id: 'dormitorio',
			familyId: 'A',
			name: 'dormitorio'
		});
		const [row] = await db
			.select({ at: voiceSatellite.lastSeenAt })
			.from(voiceSatellite)
			.where(eq(voiceSatellite.id, 'dormitorio'));
		expect(row!.at).not.toBeNull();
	});

	test('no key, nothing', async () => {
		expect(await satelliteOfKey('satelite_nada')).toBeNull();
		expect(await satelliteOfKey(keyA.key.replace('satelite_', 'nube_'))).toBeNull();
	});

	test('a family sees only its own', async () => {
		const rows = await asFamily('A', (tx) => tx.select().from(voiceSatellite));
		expect(rows.map((r) => r.id)).toEqual(['dormitorio']);
	});
});

describe('satellite timers', () => {
	const k = house('A');
	const place = 'satelite:dormitorio' as const;

	test('kept at its place, said to the AI, and taken away', async () => {
		expect(await startTimerAt(k, place, { label: '', seconds: 1800 })).toBe('30 minutos');
		expect((await describeTimersAt(k, place)).join(' ')).toContain('30 minutos');
		// Not another family's, nor another place's.
		expect(await describeTimersAt(house('B'), place)).toEqual([]);
		expect(await cancelTimersAt(k, place, null)).toBe(1);
	});

	test('ringing there, and its wake word stops it', async () => {
		await startTimerAt(k, place, { label: 'la pasta', seconds: 600 });
		await db
			.update(alarm)
			.set({ ringingSince: new Date(), nextAt: null })
			.where(eq(alarm.label, 'la pasta'));
		expect(await ringingFor(k, 'dormitorio')).toEqual({
			ringing: ['la pasta'],
			play: ['la pasta']
		});
		expect(await ringingFor(house('B'), 'cocina')).toEqual({ ringing: [], play: [] });
		expect(await stopRingingAt(k, place)).toBe(1);
		expect(await ringingFor(k, 'dormitorio')).toEqual({ ringing: [], play: [] });
	});
});
