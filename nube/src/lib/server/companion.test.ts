import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import {
	companion,
	companionCheck,
	family,
	familyLink,
	familyMember,
	user,
	voiceSatellite
} from './db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily, userScope } from './family-scope.ts';
import { familyLinkScope } from './family-link-scope.ts';

/**
 * «Compañía» (#469), on a real Postgres (PGlite) as the app's role: the clock asks on the satellite
 * that is there, an answer is a ✓, the TV is not, no answer after the tries tells only the adults
 * of the linked families (faked phones), and «Ya lo he mirado», the pause and a satellite gone.
 */

const SAT = 'sat-carmen';
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const asUser = userScope(db, { role: 'app_user' });
const told: { family: string; to: string[]; title: string; body: string }[] = [];
let ai: (name: string, prompt: string) => unknown = () => {
	throw new Error('sin IA');
};

mock.module('#lib/server/db/index.ts', () => ({ db }));
mock.module('#lib/server/family.ts', () => ({ withFamily, asFamily, asUser, NoFamily }));
// As the app's role: its links are read through row-level security, as in Seilide.
mock.module('#lib/server/family-links.ts', () => ({
	familyLinks: familyLinkScope(db, { role: 'app_user' })
}));
// The fridge's module brings the agenda's, and its emails: only its kitchen, as it is.
// With the names later tests fake too (chat.test.ts): a mock's names are fixed by the first one.
const notHere = () => {
	throw new Error('No en esta prueba');
};
mock.module('#lib/server/fridge.ts', () => ({
	houseKitchen: (familyId: string) => ({
		familyId,
		userId: null,
		run: <T>(fn: (tx: never) => Promise<T>) => asFamily(familyId, fn as never)
	}),
	kitchenOf: notHere,
	toBuy: notHere,
	addItems: notHere
}));
// As other tests fake it (a mock is the process's): Carmen's one satellite.
mock.module('#lib/server/satellites.ts', () => ({
	familySatellites: async (familyId: string) =>
		familyId === 'E' ? [{ id: SAT, name: 'Salón' }] : [],
	servedSatellites: async () => [],
	satellitesChanged: async () => {}
}));
mock.module('#lib/server/push.ts', () => ({
	notify: async (family: string, to: string[], m: { title: string; body: string }) =>
		void told.push({ family, to, title: m.title, body: m.body })
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => 'clave' }));
mock.module('#lib/server/openrouter.ts', () => ({
	completeJson: async (r: { name: string; prompt: string }) => ai(r.name, r.prompt),
	chatWithTools: notHere,
	sayableError: (message: string) => message
}));

const c = await import('./companion.ts');
const { saysFor, satelliteBeat, satelliteHere } = await import('./satellite-live.ts');
const { houseKitchen } = await import('./fridge.ts');

// E: Carmen, who lives alone. C: her daughter's, linked. X: not linked.
const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m);
const carmen = houseKitchen('E');

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'E', name: 'Casa de Carmen' },
		{ id: 'C', name: 'Casa de Ana' },
		{ id: 'X', name: 'Otra' }
	]);
	await db.insert(user).values(
		['carmen', 'ana', 'pepe', 'nino', 'otro'].map((id) => ({
			id,
			name: id[0]!.toUpperCase() + id.slice(1),
			email: `${id}@test.es`,
			createdAt: new Date(),
			updatedAt: new Date()
		}))
	);
	await db.insert(familyMember).values([
		{ userId: 'carmen', familyId: 'E', role: 'admin' },
		{ userId: 'ana', familyId: 'C', role: 'admin' },
		{ userId: 'pepe', familyId: 'C', role: 'member' },
		{ userId: 'nino', familyId: 'C', role: 'peque' },
		{ userId: 'otro', familyId: 'X', role: 'admin' }
	]);
	await db.insert(familyLink).values({
		id: 'l1',
		fromFamilyId: 'E',
		toFamilyId: 'C',
		expiresAt: new Date(),
		acceptedAt: new Date()
	});
	await db
		.insert(voiceSatellite)
		.values({ id: SAT, familyId: 'E', name: 'Salón', hash: 'h', start: 's' });
	await c.saveCompanion('carmen', {
		on: true,
		name: 'Carmen',
		satelliteIds: [],
		everyMinutes: 30,
		fromTime: '09:00',
		toTime: '22:00',
		retries: 1,
		retryMinutes: 2
	});
});
afterAll(() => void setSystemTime());

/** Its beat every minute, while it is there. */
let beating = false;
const tick = (now: Date) => {
	setSystemTime(now);
	if (beating) satelliteBeat(SAT);
	return c.companionTick('E', now);
};
const row = async () => (await asFamily('E', (tx) => tx.select().from(companion)))[0]!;
const checks = () =>
	asFamily('E', (tx) => tx.select().from(companionCheck).orderBy(companionCheck.id));

describe('Compañía', () => {
	let leave = () => {};

	test('no satellite: told after a while, to the linked adults only', async () => {
		await tick(at(10));
		expect((await row()).offlineSince).toEqual(at(10));
		await tick(at(10, 5));
		expect(told).toEqual([]);
		await tick(at(10, 10));
		expect(told).toHaveLength(1);
		expect(told[0]).toMatchObject({ family: 'C', title: '⚠️ Carmen: el satélite no responde' });
		expect(told[0]!.to.sort()).toEqual(['ana', 'pepe']);
	});

	test('back: told so, then asked there', async () => {
		leave = satelliteHere(SAT, true);
		beating = true;
		ai = (name) => (name === 'pregunta' ? { question: 'Carmen, ¿has comido ya?' } : null);
		await tick(at(10, 11));
		expect(told.at(-1)!.title).toBe('✓ Carmen: el satélite vuelve a funcionar');
		expect((await row()).alertKind).toBeNull();
		await tick(at(10, 12));
		expect(saysFor(SAT)).toEqual([
			expect.objectContaining({ text: 'Carmen, ¿has comido ya?', listen: true })
		]);
	});

	test('the TV is not an answer; she is', async () => {
		ai = () => ({ answered: false, coherent: false, reply: '' });
		expect(await c.companionAnswer(carmen, 'y ahora, el tiempo en la Región de Murcia')).toBe('');
		expect((await row()).attempt).toBe(1);
		ai = (_, prompt) => {
			expect(prompt).toContain('¿has comido ya?');
			return { answered: true, coherent: true, reply: 'Qué bien, Carmen.' };
		};
		expect(await c.companionAnswer(carmen, 'sí, unas lentejas')).toBe('Qué bien, Carmen.');
		expect(saysFor(SAT)).toEqual([]);
		expect((await row()).attempt).toBe(0);
		expect(await checks()).toEqual([expect.objectContaining({ answered: true, coherent: true })]);
	});

	test('no answer: asked again, then the linked adults told', async () => {
		ai = () => {
			throw new Error('sin IA');
		};
		const before = told.length;
		await tick(at(10, 41));
		expect((await row()).attempt).toBe(0);
		await tick(at(10, 42));
		expect(saysFor(SAT)[0]!.text).toBe('Carmen, ¿qué tal estás?');
		await tick(at(10, 44));
		expect(saysFor(SAT).map((s) => s.text)).toEqual(['Carmen, ¿me oyes? Contéstame, por favor.']);
		expect(told.length).toBe(before);
		await tick(at(10, 46));
		expect(saysFor(SAT)).toEqual([]);
		expect(told.at(-1)).toMatchObject({ family: 'C', title: '⚠️ Carmen: no contesta' });
		expect(told.at(-1)!.body).toContain('10:42');
		expect((await checks()).map((r) => r.answered)).toEqual([true, false]);
	});

	test('the linked family sees ✓ and ✗; a child and another family see nothing', async () => {
		const [view] = await c.companionsFor('ana');
		expect(view).toMatchObject({ name: 'Carmen', alert: { kind: 'silent' } });
		expect(view!.checks.map((r) => r.answered)).toEqual([false, true]);
		expect(await c.companionsFor('nino')).toEqual([]);
		expect(await c.companionsFor('otro')).toEqual([]);
		expect(await c.companionSeen('otro', 'Otro', 'E')).toBe(false);
	});

	test('«Ya lo he mirado»: closed, and the others told who', async () => {
		expect(await c.companionSeen('ana', 'Ana', 'E')).toBe(true);
		expect((await row()).alertKind).toBeNull();
		expect(told.at(-1)).toMatchObject({ title: 'Carmen: lo ha mirado Ana', to: ['pepe'] });
	});

	test('anything said to a satellite answers the asking, and closes «no contesta»', async () => {
		await tick(at(11, 16));
		await tick(at(11, 18));
		await tick(at(11, 20));
		expect((await row()).alertKind).toBe('silent');
		await tick(at(11, 50));
		expect((await row()).attempt).toBe(1);
		await c.companionHeard('E');
		expect((await row()).attempt).toBe(0);
		expect((await row()).alertKind).toBeNull();
		expect(told.at(-1)!.title).toBe('✓ Carmen: ha contestado');
	});

	test('«me voy» pauses, and talking to it again ends the pause', async () => {
		expect(await c.companionAway(carmen, true, 60)).toContain('12:50');
		await tick(at(12, 30));
		expect((await row()).attempt).toBe(0);
		await c.companionHeard('E');
		expect((await row()).pausedUntil).toBeNull();
	});

	test('a pause from the linked family; a satellite that cannot ask counts as none', async () => {
		setSystemTime(at(13));
		expect(await c.companionPause('ana', 'Ana', 'E', '1h')).toBe(true);
		await tick(at(13, 30));
		expect((await row()).attempt).toBe(0);
		expect((await row()).pausedBy).toBe('Ana');
		expect(await c.companionResume('ana', 'E')).toBe(true);
		leave();
		const old = satelliteHere(SAT, false);
		// Connected and beating, but its image cannot ask.
		await tick(at(13, 31));
		expect((await row()).offlineSince).toEqual(at(13, 31));
		old();
	});
});
