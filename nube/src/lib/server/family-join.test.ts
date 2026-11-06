import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import {
	alarm,
	alarmPerson,
	calendarEvent,
	calendarEventPerson,
	expense,
	expenseLine,
	family,
	familyMember,
	familyPerson,
	familySettings,
	fridgeNote,
	house,
	invitation,
	medication,
	memory,
	note,
	oauthClient,
	paper,
	paperPerson,
	podcast,
	podcastEpisode,
	podcastProgress,
	podcastSubscription,
	recipe,
	user
} from './db/schema.ts';
import { PERSON_DATA } from './person-data.ts';

/** On a real Postgres (PGlite), as the app's role, with the files and the family's key faked. */
const files = new Map<string, string>();
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
let failCopy = false;
const storage = {
	putFile: async (f: string, area: string, name: string, body: Uint8Array) =>
		void files.set(`${f}/${area}/${name}`, text(body)),
	removeFile: async (f: string, area: string, name: string) =>
		void files.delete(`${f}/${area}/${name}`),
	removeAllFiles: async (f: string) => {
		for (const key of [...files.keys()]) if (key.startsWith(`${f}/`)) files.delete(key);
	},
	copyFile: async (from: string, to: string, area: string, name: string) => {
		if (failCopy) throw new Error('S3 caído');
		const found = files.get(`${from}/${area}/${name}`);
		if (found !== undefined) files.set(`${to}/${area}/${name}`, found);
	},
	readFile: async (f: string, area: string, name: string) => {
		const found = files.get(`${f}/${area}/${name}`);
		return found === undefined ? null : bytes(found);
	},
	listFiles: async (f: string, area: string) =>
		[...files.keys()]
			.filter((key) => key.startsWith(`${f}/${area}/`))
			.map((key) => key.slice(`${f}/${area}/`.length))
} as unknown as import('./family-join-scope.ts').MoveFilesForJoin;
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	...storage,
	fileResponse: async () => new Response()
}));
mock.module('#lib/server/family-secret.ts', () => ({
	kmsOn: true,
	sealFor: async (f: string, value: string) => `${f}:${value}`,
	openFor: async (f: string, value: string) => {
		if (!value.startsWith(`${f}:`)) throw new Error(`No es de ${f}: ${value}`);
		return value.slice(f.length + 1);
	},
	sealFileFor: async (f: string, file: Uint8Array) => bytes(`${f}:${text(file)}`),
	openFileFor: async (f: string, file: Uint8Array) => {
		const value = text(file);
		if (!value.startsWith(`${f}:`)) throw new Error(`No es de ${f}`);
		return bytes(value.slice(f.length + 1));
	}
}));

const { familyJoinScope, JOINED_TABLES } = await import('./family-join-scope.ts');

const db = drizzle(new PGlite(), { schema });
const joins = familyJoinScope(db, { role: 'app_user', storage });

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});
const luis = { id: 'luis', email: 'luis@test.es' };
const memberOf = async (userId: string) =>
	(await db.select().from(familyMember).where(eq(familyMember.userId, userId)))[0];

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
});

beforeEach(async () => {
	failCopy = false;
	files.clear();
	await db.delete(oauthClient);
	await db.delete(invitation);
	await db.delete(family);
	await db.delete(user);
	await db.insert(user).values(['ana', 'luis', 'eva'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'L', name: 'Familia de Luis' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'eva', familyId: 'A', role: 'member' },
		{ userId: 'luis', familyId: 'L', role: 'admin', theme: 'noche' }
	]);
	await db.insert(familyPerson).values([
		{ id: 1, familyId: 'A', userId: 'ana', name: 'Ana' },
		{ id: 2, familyId: 'L', userId: 'luis', name: 'Luis', avatar: 'gato' }
	]);
	await db.insert(invitation).values({
		id: 'i',
		email: 'luis@test.es',
		token: 't',
		familyId: 'A',
		role: 'member'
	});
});

describe('what accepting would do (#315)', () => {
	test('alone in a family, they can', async () => {
		expect(await joins.stateOf('t', 'luis')).toEqual({
			kind: 'canJoin',
			familyName: 'Familia de Luis'
		});
	});

	test('with an account of no family, or an invitation to make one, it is not this', async () => {
		await db.delete(familyMember).where(eq(familyMember.userId, 'luis'));
		expect(await joins.stateOf('t', 'luis')).toEqual({ kind: 'none' });
	});

	test('with someone else in their family, they leave it first', async () => {
		await db.insert(user).values(person('mia'));
		await db.insert(familyMember).values({ userId: 'mia', familyId: 'L', role: 'peque' });
		expect((await joins.stateOf('t', 'luis')).kind).toBe('blocked');
		expect((await joins.join('t', luis)).ok).toBe(false);
		expect((await memberOf('luis')).familyId).toBe('L');
	});

	test('with a house connected, they disconnect it first', async () => {
		await db.insert(house).values({ familyId: 'L', url: 'https://casa', key: 'k' });
		expect((await joins.stateOf('t', 'luis')).kind).toBe('blocked');
	});

	test('already in that family, no', async () => {
		await db.update(invitation).set({ familyId: 'L' });
		expect((await joins.stateOf('t', 'luis')).kind).toBe('blocked');
	});
});

describe('joining (#315)', () => {
	test('they are in the new family with its invitation’s role, their things, and theirs is gone', async () => {
		const done = await joins.join('t', luis);
		expect(done).toEqual({ ok: true, familyId: 'A' });
		expect(await memberOf('luis')).toMatchObject({ familyId: 'A', role: 'member', theme: 'noche' });
		const [p] = await db.select().from(familyPerson).where(eq(familyPerson.userId, 'luis'));
		expect(p).toMatchObject({ id: 2, familyId: 'A', avatar: 'gato' });
		expect((await db.select().from(family)).map((f) => f.id)).toEqual(['A']);
		const [inv] = await db.select().from(invitation).where(eq(invitation.id, 'i'));
		expect(inv.usedAt).not.toBeNull();
	});

	test('an invitation to administer makes them administer', async () => {
		await db.update(invitation).set({ role: 'admin' });
		await joins.join('t', luis);
		expect((await memberOf('luis')).role).toBe('admin');
	});

	test('money and the fridge go too, with their files', async () => {
		await db.insert(expense).values({
			id: 5,
			familyId: 'L',
			date: '2026-11-01',
			store: 'T',
			total: 100,
			category: 'o',
			source: 'ticket',
			userId: 'luis',
			receipt: 'r.jpg'
		});
		await db
			.insert(expenseLine)
			.values({ familyId: 'L', expenseId: 5, position: 0, text: 'Pan', amount: 100 });
		await db.insert(fridgeNote).values({ familyId: 'L', text: 'Leche', userId: 'luis' });
		files.set('L/gastos/r.jpg', 'ticket');
		files.set('L/frases-espera/f.wav', 'no va');
		await joins.join('t', luis);
		expect((await db.select().from(expense))[0]).toMatchObject({ id: 5, familyId: 'A' });
		expect((await db.select().from(expenseLine))[0].familyId).toBe('A');
		expect((await db.select().from(fridgeNote))[0].familyId).toBe('A');
		expect(files.get('A/gastos/r.jpg')).toBe('ticket');
		expect([...files.keys()].filter((k) => k.startsWith('L/'))).toEqual([]);
		expect(files.has('A/frases-espera/f.wav')).toBe(false);
	});

	test('what its medication points at still holds', async () => {
		await db.insert(medication).values({
			familyId: 'L',
			personId: 2,
			name: 'Suya',
			startDay: '2026-11-01',
			times: ['09:00'],
			userId: 'luis'
		});
		await joins.join('t', luis);
		expect((await db.select().from(medication))[0]).toMatchObject({ familyId: 'A', personId: 2 });
	});

	test('someone without an account in their family goes too', async () => {
		await db.insert(familyPerson).values({ id: 3, familyId: 'L', name: 'Bebé' });
		await joins.join('t', luis);
		expect((await db.select().from(familyPerson).where(eq(familyPerson.id, 3)))[0].familyId).toBe(
			'A'
		);
	});

	test('what was the house’s becomes theirs, not the new family’s whole', async () => {
		await db.insert(memory).values({ familyId: 'L', userId: null, text: 'De la casa', words: [] });
		await db
			.insert(note)
			.values({ familyId: 'L', userId: null, text: 'Del altavoz', source: 'voz' });
		await db
			.insert(calendarEvent)
			.values({ id: 1, familyId: 'L', title: 'Sin nadie', startDay: '2026-11-02' });
		await db.insert(alarm).values({
			id: 1,
			familyId: 'L',
			label: 'Sin nadie',
			time: '09:00',
			startDay: '2026-11-01',
			place: 'satelite:1'
		});
		await joins.join('t', luis);
		expect((await db.select().from(memory))[0]).toMatchObject({ familyId: 'A', userId: 'luis' });
		expect((await db.select().from(note))[0]).toMatchObject({ familyId: 'A', userId: 'luis' });
		expect((await db.select().from(calendarEventPerson))[0]).toMatchObject({
			eventId: 1,
			personId: 2
		});
		expect((await db.select().from(alarmPerson))[0]).toMatchObject({ alarmId: 1, personId: 2 });
		expect((await db.select().from(alarm))[0].place).toBe('movil');
	});

	test('a paper is sealed again with the new family’s key, its file too', async () => {
		await db.insert(paper).values({
			id: 1,
			familyId: 'L',
			name: 'L:DNI',
			notes: 'L:mío',
			category: 'otros',
			file: 'dni.pdf',
			userId: 'luis'
		});
		await db.insert(paperPerson).values({ familyId: 'L', paperId: 1, personId: 2 });
		files.set('L/papeles/dni.pdf', 'L:el dni');
		await joins.join('t', luis);
		expect((await db.select().from(paper))[0]).toMatchObject({
			familyId: 'A',
			name: 'A:DNI',
			notes: 'A:mío'
		});
		expect(files.get('A/papeles/dni.pdf')).toBe('A:el dni');
		expect(files.has('L/papeles/dni.pdf')).toBe(false);
	});

	test('a podcast both have is one: they follow the new family’s, and go on where they were', async () => {
		await db.insert(podcast).values([
			{ id: 1, familyId: 'A', feedUrl: 'https://feed', title: 'Allí' },
			{ id: 2, familyId: 'L', feedUrl: 'https://feed', title: 'Aquí' },
			{ id: 3, familyId: 'L', feedUrl: 'https://otro', title: 'Otro' }
		]);
		const episode = { title: 'E', audioUrl: 'https://a' };
		await db.insert(podcastEpisode).values([
			{ id: 1, familyId: 'A', podcastId: 1, guid: 'g', ...episode },
			{ id: 2, familyId: 'L', podcastId: 2, guid: 'g', ...episode },
			{ id: 3, familyId: 'L', podcastId: 2, guid: 'solo-aqui', ...episode },
			{ id: 4, familyId: 'L', podcastId: 3, guid: 'g', ...episode }
		]);
		await db.insert(podcastSubscription).values([
			{ familyId: 'L', userId: 'luis', podcastId: 2 },
			{ familyId: 'L', userId: 'luis', podcastId: 3 }
		]);
		await db.insert(podcastProgress).values([
			{ familyId: 'L', userId: 'luis', episodeId: 2, positionSec: 30 },
			{ familyId: 'L', userId: 'luis', episodeId: 3, positionSec: 10 }
		]);
		await joins.join('t', luis);
		expect((await db.select().from(podcast)).map((p) => p.id).sort()).toEqual([1, 3]);
		const subs = await db.select().from(podcastSubscription);
		expect(subs.map((s) => s.podcastId).sort()).toEqual([1, 3]);
		const progress = await db.select().from(podcastProgress);
		expect(progress.map((p) => p.episodeId).sort()).toEqual([1, 3]);
		expect(
			(await db.select().from(podcastEpisode).where(eq(podcastEpisode.id, 3)))[0].podcastId
		).toBe(1);
	});

	test('a recipe both have is one', async () => {
		const r = {
			title: 'Tarta',
			servings: 2,
			ingredients: [],
			steps: [],
			sourceUrl: 'https://receta',
			sourceName: 'x'
		};
		await db.insert(recipe).values([
			{ id: 1, familyId: 'A', ...r },
			{ id: 2, familyId: 'L', ...r },
			{ id: 3, familyId: 'L', ...r, sourceUrl: 'https://otra' }
		] as never);
		await joins.join('t', luis);
		expect((await db.select().from(recipe)).map((x) => x.id).sort()).toEqual([1, 3]);
	});

	test('their settings do not, nor anything of the family that was', async () => {
		await db.insert(familySettings).values({ familyId: 'L', openrouterKey: 'clave' });
		await db.insert(oauthClient).values({
			id: 'c',
			clientId: 'c',
			referenceId: 'L',
			redirectUris: ['https://x/'],
			createdAt: new Date(),
			updatedAt: new Date()
		});
		await joins.join('t', luis);
		expect(await db.select().from(familySettings)).toEqual([]);
		expect(await db.select().from(oauthClient)).toEqual([]);
	});
});

describe('when it cannot be (#315)', () => {
	test('an invitation for someone else', async () => {
		const done = await joins.join('t', { id: 'luis', email: 'otro@test.es' });
		expect(done.ok).toBe(false);
		expect((await memberOf('luis')).familyId).toBe('L');
	});

	test('used, cancelled or lapsed', async () => {
		await db.update(invitation).set({ usedAt: new Date() });
		expect((await joins.join('t', luis)).ok).toBe(false);
		await db.update(invitation).set({ usedAt: null, cancelledAt: new Date() });
		expect((await joins.join('t', luis)).ok).toBe(false);
		await db.update(invitation).set({ cancelledAt: null, expiresAt: new Date(Date.now() - 1000) });
		expect((await joins.join('t', luis)).ok).toBe(false);
		expect((await memberOf('luis')).familyId).toBe('L');
		expect(await db.select().from(family)).toHaveLength(2);
	});

	test('a failure leaves all as it was, and no copies behind', async () => {
		await db.insert(note).values({
			id: 8,
			familyId: 'L',
			userId: 'luis',
			text: 'Nota',
			audio: 'n.webm',
			source: 'pagina'
		});
		files.set('L/notas/n.webm', 'audio');
		failCopy = true;
		await expect(joins.join('t', luis)).rejects.toThrow('S3 caído');
		expect((await db.select().from(note))[0].familyId).toBe('L');
		expect(files.get('L/notas/n.webm')).toBe('audio');
		expect((await memberOf('luis')).familyId).toBe('L');
		expect([...files.keys()].filter((k) => k.startsWith('A/'))).toEqual([]);
		expect((await db.select().from(invitation))[0].usedAt).toBeNull();
	});
});

test('every table the list says goes is moved', () => {
	const going = Object.entries(PERSON_DATA)
		.filter(([, d]) => d.joining === 'moves')
		.map(([name]) => name)
		.sort();
	expect([...JOINED_TABLES].sort()).toEqual(going);
});
