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
	car,
	carDriver,
	expense,
	family,
	familyMember,
	familyPerson,
	fridgeNote,
	heard,
	inbox,
	kidGuardian,
	medication,
	medicationDose,
	memory,
	note,
	oauthClient,
	oauthConsent,
	paper,
	paperEvent,
	paperPerson,
	plannedLeg,
	plannedTrip,
	plannedTripPerson,
	podcast,
	podcastEpisode,
	podcastProgress,
	podcastSubscription,
	pushSubscription,
	savedPlace,
	trip,
	tripPhoto,
	user,
	walk,
	walkPhoto,
	watchLog
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
	}
} as unknown as import('./family-move-scope.ts').MoveFiles;
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	...storage,
	listFiles: async () => [],
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

const { familyMoveScope, HANDLED_APART, MOVED_IN_ORDER } = await import('./family-move-scope.ts');

const db = drizzle(new PGlite(), { schema });
const moves = familyMoveScope(db, { role: 'app_user', storage });

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});
const at = new Date('2026-11-05T10:00:00Z');
const family_ = async (userId: string) =>
	(await db.select().from(familyMember).where(eq(familyMember.userId, userId)))[0]?.familyId;

async function leftOk(by: string, userId: string) {
	const done = await moves.leave(by, userId);
	if (!done.ok) throw new Error(done.problem);
	return done;
}

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
	await db.delete(family);
	await db.delete(user);
	await db.insert(user).values(['ana', 'luis', 'eva', 'peque', 'berta'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'luis', familyId: 'A', role: 'member', voiceStyle: 'breve', theme: 'noche' },
		{ userId: 'eva', familyId: 'A', role: 'member' },
		{ userId: 'peque', familyId: 'A', role: 'peque' },
		{ userId: 'berta', familyId: 'B', role: 'admin' }
	]);
	await db.insert(familyPerson).values([
		{ id: 1, familyId: 'A', userId: 'ana', name: 'Ana' },
		{ id: 2, familyId: 'A', userId: 'luis', name: 'Luis', avatar: 'gato' },
		{ id: 3, familyId: 'A', userId: 'peque', name: 'Peque' }
	]);
	await db.execute(sql`select setval('family_person_id_seq', 100)`);
	for (const seq of [
		'calendar_event',
		'alarm',
		'paper',
		'planned_trip',
		'planned_leg',
		'podcast',
		'podcast_episode'
	])
		await db.execute(sql.raw(`select setval('${seq}_id_seq', 100)`));
});

describe('who can do it (#315)', () => {
	test('the administrator unlinks an adult; not another administrator, nor a child', async () => {
		expect((await moves.leave('ana', 'peque')).ok).toBe(false);
		await db.execute(sql`update family_member set role = 'admin' where user_id = 'eva'`);
		expect((await moves.leave('ana', 'eva')).ok).toBe(false);
		expect((await moves.leave('ana', 'luis')).ok).toBe(true);
	});

	test('someone who does not administer only themselves', async () => {
		expect((await moves.leave('eva', 'luis')).ok).toBe(false);
		expect((await moves.leave('eva', 'eva')).ok).toBe(true);
	});

	test('the only administrator hands over first; the only adult has nothing to leave', async () => {
		expect((await moves.leave('ana', 'ana')).ok).toBe(false);
		expect((await moves.leave('berta', 'berta')).ok).toBe(false);
		expect(await family_('ana')).toBe('A');
	});

	test('an administrator with another may', async () => {
		await db.execute(sql`update family_member set role = 'admin' where user_id = 'eva'`);
		expect((await moves.leave('ana', 'ana')).ok).toBe(true);
	});

	test('someone of another family is not there to be unlinked', async () => {
		expect((await moves.leave('ana', 'berta')).ok).toBe(false);
		expect(await family_('berta')).toBe('B');
	});

	test('nothing stays half done, and no family is made, when it is refused', async () => {
		await moves.leave('eva', 'luis');
		expect((await db.select().from(family)).length).toBe(2);
	});
});

describe('the family of one (#315)', () => {
	test('they administer it, with their settings and drawing, under their name', async () => {
		const done = await leftOk('ana', 'luis');
		expect(done.familyName).toBe('Familia de luis');
		const [m] = await db.select().from(familyMember).where(eq(familyMember.userId, 'luis'));
		expect(m).toMatchObject({
			familyId: done.familyId,
			role: 'admin',
			voiceStyle: 'breve',
			theme: 'noche'
		});
		const [p] = await db.select().from(familyPerson).where(eq(familyPerson.userId, 'luis'));
		expect(p).toMatchObject({ familyId: done.familyId, avatar: 'gato' });
		expect(p.id).not.toBe(2);
	});

	test('with nothing shared, their person goes from the old family', async () => {
		await leftOk('ana', 'luis');
		expect(await db.select().from(familyPerson).where(eq(familyPerson.id, 2))).toEqual([]);
	});
});

describe('what goes (#315)', () => {
	test('their own, by the account, keeping ids; the others’ stay', async () => {
		await db
			.insert(trip)
			.values({ id: 5, familyId: 'A', userId: 'luis', startedAt: at, endedAt: at });
		await db
			.insert(tripPhoto)
			.values({ id: 7, familyId: 'A', userId: 'luis', tripId: 5, takenAt: at });
		await db
			.insert(savedPlace)
			.values({ familyId: 'A', userId: 'luis', name: 'Casa', lon: 1, lat: 2 });
		await db.insert(walk).values({
			id: 3,
			familyId: 'A',
			userId: 'luis',
			startedAt: at,
			endedAt: at,
			diagnosis: {} as never
		});
		await db
			.insert(walkPhoto)
			.values({ familyId: 'A', userId: 'luis', walkId: 3, clientId: 'c', file: 'p.jpg', at });
		await db.insert(note).values([
			{
				id: 8,
				familyId: 'A',
				userId: 'luis',
				text: 'De Luis',
				audio: 'n.webm',
				source: 'pagina',
				walkId: 3
			},
			{ id: 9, familyId: 'A', userId: 'ana', text: 'De Ana', audio: 'a.webm', source: 'pagina' }
		]);
		const watched = {
			day: '2026-11-06',
			minute: 1270,
			item: 'e1',
			kind: 'serie',
			title: 'T'
		} as const;
		await db.insert(watchLog).values([
			{ ...watched, familyId: 'A', userId: 'luis', seconds: 60 },
			{ ...watched, familyId: 'A', userId: 'ana', seconds: 90 }
		]);
		await db.insert(memory).values([
			{ familyId: 'A', userId: 'luis', text: 'Suyo', words: [] },
			{ familyId: 'A', userId: null, text: 'De la casa', words: [] }
		]);
		await db.insert(heard).values([
			{ familyId: 'A', userId: 'luis', text: 'Dicho' },
			{ familyId: 'A', userId: null, text: 'En un satélite' }
		]);
		await db.insert(inbox).values({
			familyId: 'A',
			userId: 'luis',
			kind: 'recado',
			title: 't',
			body: 'b',
			url: '/',
			fromUserId: 'ana'
		});
		await db
			.insert(pushSubscription)
			.values({ familyId: 'A', userId: 'luis', endpoint: 'https://push', p256dh: 'x', auth: 'y' });
		files.set('A/fotos/7.jpg', 'foto');
		files.set('A/paseos/p.jpg', 'paseo');
		files.set('A/notas/n.webm', 'audio');
		files.set('A/notas/a.webm', 'de ana');

		const { familyId } = await leftOk('ana', 'luis');

		const log = await db.select().from(watchLog);
		expect(log.find((r) => r.userId === 'ana')?.familyId).toBe('A');
		expect(log.find((r) => r.userId === 'luis')?.familyId).not.toBe('A');
		const [n] = await db.select().from(note).where(eq(note.id, 8));
		expect(n).toMatchObject({ familyId, walkId: 3, audio: 'n.webm' });
		expect((await db.select().from(note).where(eq(note.id, 9)))[0].familyId).toBe('A');
		expect((await db.select().from(tripPhoto).where(eq(tripPhoto.id, 7)))[0]).toMatchObject({
			familyId,
			tripId: 5
		});
		expect((await db.select().from(walkPhoto))[0].familyId).toBe(familyId);
		expect((await db.select().from(savedPlace))[0].familyId).toBe(familyId);
		expect((await db.select().from(pushSubscription))[0].familyId).toBe(familyId);
		const [mail] = await db.select().from(inbox);
		expect(mail).toMatchObject({ familyId, fromUserId: null });
		expect((await db.select().from(memory)).map((m) => [m.text, m.familyId]).sort()).toEqual([
			['De la casa', 'A'],
			['Suyo', familyId]
		]);
		expect((await db.select().from(heard)).map((h) => [h.text, h.familyId]).sort()).toEqual([
			['Dicho', familyId],
			['En un satélite', 'A']
		]);
		expect(files.get(`${familyId}/fotos/7.jpg`)).toBe('foto');
		expect(files.get(`${familyId}/paseos/p.jpg`)).toBe('paseo');
		expect(files.get(`${familyId}/notas/n.webm`)).toBe('audio');
		expect(files.has('A/fotos/7.jpg')).toBe(false);
		expect(files.has('A/notas/n.webm')).toBe(false);
		expect(files.get('A/notas/a.webm')).toBe('de ana');
	});

	test('their medication, by whom it is for, with its doses; others’ stay', async () => {
		const dose = { startDay: '2026-11-01', times: ['09:00'] };
		await db.insert(medication).values([
			{ id: 1, familyId: 'A', personId: 2, name: 'De Luis', userId: 'ana', ...dose },
			{ id: 2, familyId: 'A', personId: 3, name: 'De Peque', userId: 'luis', ...dose }
		]);
		await db.insert(medicationDose).values({
			familyId: 'A',
			medicationId: 1,
			day: '2026-11-01',
			time: '09:00',
			takenAt: at,
			takenBy: 'ana'
		});
		const { familyId } = await leftOk('ana', 'luis');
		const [mine] = await db.select().from(medication).where(eq(medication.id, 1));
		const [p] = await db.select().from(familyPerson).where(eq(familyPerson.userId, 'luis'));
		expect(mine).toMatchObject({ familyId, personId: p.id, userId: null });
		expect((await db.select().from(medicationDose))[0]).toMatchObject({ familyId, takenBy: null });
		expect((await db.select().from(medication).where(eq(medication.id, 2)))[0]).toMatchObject({
			familyId: 'A',
			personId: 3
		});
	});

	test('an event only theirs moves; a shared one is copied and their name stays on it', async () => {
		await db.insert(calendarEvent).values([
			{ id: 1, familyId: 'A', title: 'Solo Luis', startDay: '2026-11-02', userId: 'ana' },
			{ id: 2, familyId: 'A', title: 'De los dos', startDay: '2026-11-03', userId: 'luis' },
			{ id: 3, familyId: 'A', title: 'De Ana', startDay: '2026-11-04', userId: 'luis' }
		]);
		await db.insert(calendarEventPerson).values([
			{ familyId: 'A', eventId: 1, personId: 2 },
			{ familyId: 'A', eventId: 2, personId: 2 },
			{ familyId: 'A', eventId: 2, personId: 1 },
			{ familyId: 'A', eventId: 3, personId: 1 }
		]);
		const { familyId } = await leftOk('ana', 'luis');
		const rows = await db.select().from(calendarEvent);
		expect(
			rows
				.filter((e) => e.familyId === 'A')
				.map((e) => e.title)
				.sort()
		).toEqual(['De Ana', 'De los dos']);
		const theirs = rows.filter((e) => e.familyId === familyId);
		expect(theirs.map((e) => e.title).sort()).toEqual(['De los dos', 'Solo Luis']);
		expect(theirs.find((e) => e.title === 'Solo Luis')).toMatchObject({ id: 1, userId: null });
		const copy = theirs.find((e) => e.title === 'De los dos')!;
		expect(copy.id).not.toBe(2);
		expect(copy.userId).toBe('luis');
		const [p] = await db.select().from(familyPerson).where(eq(familyPerson.userId, 'luis'));
		expect(
			await db.select().from(calendarEventPerson).where(eq(calendarEventPerson.personId, p.id))
		).toHaveLength(2);
		const [old] = await db.select().from(familyPerson).where(eq(familyPerson.id, 2));
		expect(old).toMatchObject({ familyId: 'A', userId: null, name: 'luis' });
		expect(
			await db.select().from(calendarEventPerson).where(eq(calendarEventPerson.eventId, 2))
		).toHaveLength(2);
	});

	test('an alarm rings on their phone, as there are no satellites', async () => {
		await db.insert(alarm).values({
			id: 1,
			familyId: 'A',
			label: 'Pastilla',
			time: '09:00',
			startDay: '2026-11-01',
			place: 'satelite:3',
			ringingSince: at
		} as never);
		await db.insert(alarmPerson).values({ familyId: 'A', alarmId: 1, personId: 2 });
		const { familyId } = await leftOk('ana', 'luis');
		expect((await db.select().from(alarm))[0]).toMatchObject({
			id: 1,
			familyId,
			place: 'movil',
			ringingSince: null
		});
	});

	test('a paper is sealed again with the new family’s key, its file too', async () => {
		const p = { familyId: 'A', category: 'otros', userId: 'ana' };
		await db.insert(paper).values([
			{ id: 1, name: 'A:DNI', notes: 'A:mío', file: 'dni.pdf', ...p },
			{ id: 2, name: 'A:Alquiler', file: 'alquiler.pdf', ...p },
			{ id: 3, name: 'A:De Ana', file: 'ana.pdf', ...p }
		]);
		await db.insert(paperPerson).values([
			{ familyId: 'A', paperId: 1, personId: 2 },
			{ familyId: 'A', paperId: 2, personId: 2 },
			{ familyId: 'A', paperId: 2, personId: 1 },
			{ familyId: 'A', paperId: 3, personId: 1 }
		]);
		files.set('A/papeles/dni.pdf', 'A:el dni');
		files.set('A/papeles/alquiler.pdf', 'A:el contrato');
		files.set('A/papeles/ana.pdf', 'A:de ana');
		const { familyId } = await leftOk('ana', 'luis');
		const rows = await db.select().from(paper);
		expect(rows.find((r) => r.id === 1)).toMatchObject({
			familyId,
			name: `${familyId}:DNI`,
			notes: `${familyId}:mío`,
			userId: null
		});
		const copy = rows.find((r) => r.familyId === familyId && r.id !== 1)!;
		expect(copy.name).toBe(`${familyId}:Alquiler`);
		expect(rows.find((r) => r.id === 2)).toMatchObject({ familyId: 'A', name: 'A:Alquiler' });
		expect(files.get(`${familyId}/papeles/dni.pdf`)).toBe(`${familyId}:el dni`);
		expect(files.get(`${familyId}/papeles/alquiler.pdf`)).toBe(`${familyId}:el contrato`);
		expect(files.has('A/papeles/dni.pdf')).toBe(false);
		expect(files.get('A/papeles/alquiler.pdf')).toBe('A:el contrato');
		expect(files.has(`${familyId}/papeles/ana.pdf`)).toBe(false);
	});

	test('a paper keeps its event only if the event goes too', async () => {
		const p = { familyId: 'A', category: 'otros', userId: 'luis' };
		await db.insert(paper).values([{ id: 1, name: 'A:x', file: 'x.pdf', ...p }]);
		await db.insert(paperPerson).values({ familyId: 'A', paperId: 1, personId: 2 });
		await db.insert(calendarEvent).values([
			{ id: 1, familyId: 'A', title: 'Suyo', startDay: '2026-11-02' },
			{ id: 2, familyId: 'A', title: 'De otros', startDay: '2026-11-02' }
		]);
		await db.insert(calendarEventPerson).values([
			{ familyId: 'A', eventId: 1, personId: 2 },
			{ familyId: 'A', eventId: 2, personId: 1 }
		]);
		await db.insert(paperEvent).values([
			{ familyId: 'A', paperId: 1, eventId: 1 },
			{ familyId: 'A', paperId: 1, eventId: 2 }
		]);
		const { familyId } = await leftOk('ana', 'luis');
		expect(await db.select().from(paperEvent)).toEqual([{ familyId, paperId: 1, eventId: 1 }]);
	});

	test('a planned trip: only theirs moves with its legs; shared is copied; another’s private stays', async () => {
		const leg = { day: '2026-11-10', time: '09:00', stops: [], line: [], distance: 1, duration: 1 };
		await db
			.insert(calendarEvent)
			.values({ id: 1, familyId: 'A', title: 'Viaje', startDay: '2026-11-10' });
		await db.insert(calendarEventPerson).values({ familyId: 'A', eventId: 1, personId: 2 });
		await db.insert(plannedTrip).values([
			{ id: 1, familyId: 'A', name: 'Solo Luis', userId: 'ana' },
			{ id: 2, familyId: 'A', name: 'De los dos', userId: 'luis' },
			{ id: 3, familyId: 'A', name: 'Privado de Ana', private: true, userId: 'ana' },
			{ id: 4, familyId: 'A', name: 'Privado de Luis', private: true, userId: 'luis' }
		]);
		await db.insert(plannedTripPerson).values([
			{ familyId: 'A', tripId: 1, personId: 2 },
			{ familyId: 'A', tripId: 2, personId: 2 },
			{ familyId: 'A', tripId: 2, personId: 1 },
			{ familyId: 'A', tripId: 3, personId: 2 }
		]);
		await db.insert(plannedLeg).values([
			{ id: 1, familyId: 'A', tripId: 1, eventId: 1, ...leg },
			{ id: 2, familyId: 'A', tripId: 2, ...leg }
		]);
		const { familyId } = await leftOk('ana', 'luis');
		const rows = await db.select().from(plannedTrip);
		expect(
			rows
				.filter((t) => t.familyId === familyId)
				.map((t) => t.name)
				.sort()
		).toEqual(['De los dos', 'Privado de Luis', 'Solo Luis']);
		expect(
			rows
				.filter((t) => t.familyId === 'A')
				.map((t) => t.name)
				.sort()
		).toEqual(['De los dos', 'Privado de Ana']);
		const legs = await db.select().from(plannedLeg);
		expect(legs.find((l) => l.id === 1)).toMatchObject({ familyId, tripId: 1, eventId: 1 });
		expect(legs.filter((l) => l.familyId === familyId)).toHaveLength(2);
		expect(legs.filter((l) => l.familyId === 'A')).toHaveLength(1);
		const [p] = await db.select().from(familyPerson).where(eq(familyPerson.userId, 'luis'));
		expect(
			await db.select().from(plannedTripPerson).where(eq(plannedTripPerson.personId, p.id))
		).toHaveLength(2);
	});

	test('a car goes with its only driver; shared, it stays, and trips forget it', async () => {
		await db.insert(car).values([
			{ id: 1, familyId: 'A', name: 'Suyo', parkedBy: 'ana' },
			{ id: 2, familyId: 'A', name: 'De todos' }
		]);
		await db.insert(carDriver).values([
			{ familyId: 'A', userId: 'luis', carId: 1 },
			{ familyId: 'A', userId: 'eva', carId: 2 },
			{ familyId: 'A', userId: 'ana', carId: 2 }
		]);
		await db
			.insert(trip)
			.values({ id: 1, familyId: 'A', userId: 'luis', startedAt: at, endedAt: at, carId: 1 });
		const { familyId } = await leftOk('ana', 'luis');
		expect((await db.select().from(car).where(eq(car.id, 1)))[0]).toMatchObject({
			familyId,
			parkedBy: null
		});
		expect((await db.select().from(trip))[0].carId).toBe(1);
		const { familyId: evaFamily } = await leftOk('ana', 'eva');
		expect((await db.select().from(car).where(eq(car.id, 2)))[0].familyId).toBe('A');
		expect(await db.select().from(carDriver).where(eq(carDriver.userId, 'eva'))).toEqual([]);
		expect(evaFamily).not.toBe('A');
	});

	test('podcasts they follow are copied, with where they were', async () => {
		await db.insert(podcast).values({ id: 1, familyId: 'A', feedUrl: 'https://feed', title: 'P' });
		await db.insert(podcastEpisode).values([
			{ id: 1, familyId: 'A', podcastId: 1, guid: 'g1', title: 'E1', audioUrl: 'https://a' },
			{ id: 2, familyId: 'A', podcastId: 1, guid: 'g2', title: 'E2', audioUrl: 'https://b' }
		]);
		await db.insert(podcastSubscription).values([
			{ familyId: 'A', userId: 'luis', podcastId: 1 },
			{ familyId: 'A', userId: 'ana', podcastId: 1 }
		]);
		await db
			.insert(podcastProgress)
			.values({ familyId: 'A', userId: 'luis', episodeId: 2, positionSec: 30 });
		const { familyId } = await leftOk('ana', 'luis');
		const shows = await db.select().from(podcast);
		expect(shows).toHaveLength(2);
		const copy = shows.find((s) => s.familyId === familyId)!;
		const [sub] = await db
			.select()
			.from(podcastSubscription)
			.where(eq(podcastSubscription.userId, 'luis'));
		expect(sub).toMatchObject({ familyId, podcastId: copy.id });
		const [progress] = await db.select().from(podcastProgress);
		const episode = (
			await db.select().from(podcastEpisode).where(eq(podcastEpisode.id, progress.episodeId))
		)[0];
		expect(episode).toMatchObject({ familyId, guid: 'g2', podcastId: copy.id });
		expect(
			await db.select().from(podcastEpisode).where(eq(podcastEpisode.familyId, 'A'))
		).toHaveLength(2);
	});
});

describe('what stays (#315)', () => {
	test('money and the fridge, without changing; their author is still known', async () => {
		await db.insert(expense).values({
			familyId: 'A',
			date: '2026-11-01',
			store: 'T',
			total: 1,
			category: 'o',
			source: 'mano',
			userId: 'luis'
		});
		await db.insert(fridgeNote).values({ familyId: 'A', text: 'Leche', userId: 'luis' });
		await leftOk('ana', 'luis');
		expect((await db.select().from(expense))[0]).toMatchObject({ familyId: 'A', userId: 'luis' });
		expect((await db.select().from(fridgeNote))[0].familyId).toBe('A');
	});

	test('a child left with no adult is said; its row goes', async () => {
		await db.insert(kidGuardian).values({ familyId: 'A', kidId: 'peque', guardianId: 'luis' });
		const done = await leftOk('ana', 'luis');
		expect(done.orphanKids).toEqual(['peque']);
		expect(done.admins).toEqual(['ana']);
		expect(await db.select().from(kidGuardian)).toEqual([]);
		expect(await family_('peque')).toBe('A');
	});

	test('the old house’s way in is cut; another app’s is not', async () => {
		const client = (id: string, referenceId?: string) => ({
			id,
			clientId: id,
			referenceId,
			redirectUris: ['https://x/'],
			createdAt: new Date(),
			updatedAt: new Date()
		});
		await db.insert(oauthClient).values([client('casa', 'A'), client('langua')]);
		const consent = {
			userId: 'luis',
			scopes: ['openid'],
			createdAt: new Date(),
			updatedAt: new Date()
		};
		await db.insert(oauthConsent).values([
			{ id: '1', clientId: 'casa', ...consent },
			{ id: '2', clientId: 'langua', ...consent }
		]);
		await leftOk('ana', 'luis');
		expect((await db.select().from(oauthConsent)).map((c) => c.clientId)).toEqual(['langua']);
		expect(await db.select().from(oauthClient)).toHaveLength(2);
	});
});

describe('when something fails (#315)', () => {
	test('the old family is as it was, and the new one and its files are gone', async () => {
		await db.insert(note).values({
			id: 8,
			familyId: 'A',
			userId: 'luis',
			text: 'Nota',
			audio: 'n.webm',
			source: 'pagina'
		});
		files.set('A/notas/n.webm', 'audio');
		failCopy = true;
		await expect(moves.leave('ana', 'luis')).rejects.toThrow('S3 caído');
		expect((await db.select().from(note))[0].familyId).toBe('A');
		expect(await family_('luis')).toBe('A');
		expect((await db.select().from(family)).map((f) => f.id).sort()).toEqual(['A', 'B']);
		expect(files.get('A/notas/n.webm')).toBe('audio');
	});

	test('a paper that cannot be opened stops it all, before anything moves', async () => {
		await db
			.insert(paper)
			.values({ id: 1, familyId: 'A', name: 'roto', category: 'o', file: 'x.pdf', userId: 'ana' });
		await db.insert(paperPerson).values({ familyId: 'A', paperId: 1, personId: 2 });
		await expect(moves.leave('ana', 'luis')).rejects.toThrow();
		expect(await family_('luis')).toBe('A');
		expect((await db.select().from(paper))[0].familyId).toBe('A');
		expect(await db.select().from(family)).toHaveLength(2);
	});
});

test('every table the list says leaves is handled by the move', () => {
	const leaving = Object.entries(PERSON_DATA)
		.filter(([, d]) =>
			['moves', 'onlyTheirsOrCopy', 'onlyTheirsOrStays', 'copies'].includes(d.leaving)
		)
		.map(([name]) => name)
		.sort();
	expect(([...MOVED_IN_ORDER, ...HANDLED_APART] as string[]).sort()).toEqual(leaving);
});
