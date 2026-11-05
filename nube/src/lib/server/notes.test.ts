import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '#lib/server/db/schema.ts';
import { family, note, user, walk, walkPhoto } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/** Notes (#416) and a walk's photos on PGlite, with the files and the hearing faked. */
const files = new Map<string, Uint8Array>();
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async (_f: string, area: string, name: string, body: Uint8Array) =>
		void files.set(`${area}/${name}`, body),
	removeFile: async (_f: string, area: string, name: string) =>
		void files.delete(`${area}/${name}`),
	readFile: async (_f: string, area: string, name: string) => files.get(`${area}/${name}`) ?? null,
	listFiles: async () => [],
	fileResponse: async () => new Response()
}));
let hears: () => Promise<string> = async () => 'Llamar al fontanero';
mock.module('#lib/server/voice/hear.ts', () => ({
	hearAudio: () => hears(),
	HearProblem: class extends Error {}
}));
mock.module('#lib/server/fridge.ts', () => ({
	dayOf: (d: Date) => d.toISOString().slice(0, 10),
	today: () => '2026-11-05',
	// A mock is the whole process's: for the tests that come after and only import these.
	houseKitchen: () => {
		throw new Error('Sin cocina en esta prueba');
	},
	kitchenOf: () => {
		throw new Error('Sin cocina en esta prueba');
	}
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => null }));

const {
	addRecordedNote,
	addSaidNote,
	deleteNote,
	describeNotes,
	editNote,
	hearAgain,
	listNotes,
	noteAudio,
	NotAudio,
	walkNotes
} = await import('./notes.ts');
const { addWalkPhoto, deleteWalk, walkPhotoFile, walkPhotos } = await import('./walks/walks.ts');
const { NotADocument } = await import('./expenses/income.ts');
const { personFiles, removePersonFiles } = await import('./person-files.ts');

const db = drizzle(new PGlite(), { schema });
const kitchen = (userId: string | null): Kitchen => ({
	familyId: 'A',
	userId,
	run: (fn) => db.transaction((tx) => fn(tx))
});
const ana = kitchen('ana');
const anaWho = { id: 'ana', email: 'ana@example.test' };
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const STARTED = new Date('2026-11-05T10:00:00Z');
let n = 0;
const recording = (over = {}) => ({
	clientId: `cliente-${++n}`,
	at: new Date('2026-11-05T10:05:00Z'),
	lon: -1.1,
	lat: 37.9,
	walkStarted: null,
	file: WEBM,
	...over
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
	const person = (id: string) => ({
		id,
		name: id,
		email: `${id}@example.test`,
		createdAt: new Date(),
		updatedAt: new Date()
	});
	await db.insert(user).values([person('ana'), person('luis')]);
});

beforeEach(async () => {
	hears = async () => 'Llamar al fontanero';
	files.clear();
	await db.execute(sql`truncate note, walk_photo, walk cascade`);
});

async function aWalk() {
	const [row] = await db
		.insert(walk)
		.values({
			familyId: 'A',
			userId: 'ana',
			startedAt: STARTED,
			endedAt: new Date('2026-11-05T11:00:00Z'),
			diagnosis: { fixes: 0, hiddenFixes: 0, musicFixes: 0, hiddenSeconds: 0, gaps: [] }
		})
		.returning({ id: walk.id });
	return row!.id;
}

test('recorded: kept and heard; sent twice, once', async () => {
	const sent = recording();
	await addRecordedNote(ana, anaWho, sent);
	await addRecordedNote(ana, anaWho, sent);
	const notes = await listNotes(ana, 'ana', null);
	expect(notes).toHaveLength(1);
	expect(notes[0]).toMatchObject({
		text: 'Llamar al fontanero',
		hearing: 'ready',
		hasAudio: true,
		mine: true,
		source: 'pagina'
	});
	expect(files.size).toBe(1);
});

test('not heard: kept, and heard when tried again', async () => {
	hears = async () => {
		throw new Error('La casa no contesta');
	};
	await addRecordedNote(ana, anaWho, recording());
	const [failed] = await listNotes(ana, 'ana', null);
	expect(failed).toMatchObject({ hearing: 'failed', text: '', hasAudio: true });
	hears = async () => 'Ya se oye';
	expect(await hearAgain(ana, anaWho, failed!.id)).toBe(true);
	expect((await listNotes(ana, 'ana', null))[0]).toMatchObject({
		hearing: 'ready',
		text: 'Ya se oye'
	});
});

test('not a recording: neither note nor file', async () => {
	await expect(
		addRecordedNote(ana, anaWho, recording({ file: new TextEncoder().encode('<html>') }))
	).rejects.toThrow(NotAudio);
	expect(await listNotes(ana, 'ana', null)).toHaveLength(0);
	expect(files.size).toBe(0);
});

test('private to their person; said to a satellite, the whole house', async () => {
	await addSaidNote(ana, 'ana', 'De Ana');
	await addSaidNote(kitchen(null), null, 'De la casa');
	expect((await listNotes(ana, 'ana', null)).map((x) => x.text).sort()).toEqual([
		'De Ana',
		'De la casa'
	]);
	expect((await listNotes(kitchen('luis'), 'luis', null)).map((x) => x.text)).toEqual([
		'De la casa'
	]);
	expect(
		await describeNotes(kitchen(null), null, { words: null, fromDay: null, untilDay: null })
	).not.toContain('De Ana');
});

test('someone else’s cannot be edited, deleted or listened to', async () => {
	await addRecordedNote(ana, anaWho, recording());
	const [mine] = await listNotes(ana, 'ana', null);
	const luis = kitchen('luis');
	expect(await editNote(luis, 'luis', mine!.id, 'Otra cosa')).toBe(false);
	await deleteNote(luis, 'luis', mine!.id);
	expect(await noteAudio(luis, 'luis', mine!.id)).toBeNull();
	expect(await hearAgain(luis, { id: 'luis', email: 'l@example.test' }, mine!.id)).toBe(false);
	expect((await listNotes(ana, 'ana', null))[0]?.text).toBe('Llamar al fontanero');
	expect(files.size).toBe(1);
});

test('found without caring for accents, also by its days; said only with text', async () => {
	await db.insert(note).values([
		{
			familyId: 'A',
			userId: 'ana',
			text: 'Revisión del Coche',
			source: 'voz',
			at: new Date('2026-11-04T12:00:00Z')
		},
		{
			familyId: 'A',
			userId: 'ana',
			text: 'Comprar pan',
			source: 'voz',
			at: new Date('2026-11-05T12:00:00Z')
		},
		{
			familyId: 'A',
			userId: 'ana',
			text: '100% seguro',
			source: 'voz',
			at: new Date('2026-11-03T12:00:00Z')
		}
	]);
	expect(await listNotes(ana, 'ana', 'revision coche')).toHaveLength(0);
	expect((await listNotes(ana, 'ana', 'REVISIÓN'))[0]?.text).toBe('Revisión del Coche');
	expect(await listNotes(ana, 'ana', '%')).toHaveLength(1);
	const said = await describeNotes(ana, 'ana', {
		words: null,
		fromDay: '2026-11-04',
		untilDay: '2026-11-04'
	});
	expect(said).toBe('2026-11-04: Revisión del Coche');
	expect(await addSaidNote(ana, 'ana', '   ')).toBeNull();
});

test('deleted: its audio goes', async () => {
	await addRecordedNote(ana, anaWho, recording());
	const [mine] = await listNotes(ana, 'ana', null);
	await deleteNote(ana, 'ana', mine!.id);
	expect(await listNotes(ana, 'ana', null)).toHaveLength(0);
	expect(files.size).toBe(0);
});

test('a walk: its photos go with it, its notes stay with their place', async () => {
	const id = await aWalk();
	const base = { at: new Date('2026-11-05T10:10:00Z'), lon: -1.1, lat: 37.9, startedAt: STARTED };
	expect(await addWalkPhoto(ana, { ...base, clientId: 'foto-una-1', file: JPEG })).toBe(true);
	expect(await addWalkPhoto(ana, { ...base, clientId: 'foto-una-1', file: JPEG })).toBe(true);
	await addRecordedNote(ana, anaWho, recording({ walkStarted: STARTED }));
	expect(await walkPhotos(ana, id)).toHaveLength(1);
	expect(await walkNotes(ana, id)).toHaveLength(1);
	expect((await walkNotes(ana, id))[0]?.source).toBe('paseo');
	const [photo] = await walkPhotos(ana, id);
	expect(await walkPhotoFile(kitchen('luis'), photo!.id)).toBeNull();

	await deleteWalk(kitchen('luis'), id);
	expect(await walkPhotos(ana, id)).toHaveLength(1);
	expect(files.size).toBe(2);

	await deleteWalk(ana, id);
	expect(await db.select().from(walkPhoto)).toHaveLength(0);
	const [kept] = await listNotes(ana, 'ana', null);
	expect(kept).toMatchObject({ text: 'Llamar al fontanero', lon: -1.1, hasAudio: true });
	expect([...files.keys()].every((name) => name.startsWith('notas/'))).toBe(true);
});

test('a photo: only a picture, and only of a walk that is there', async () => {
	await aWalk();
	const base = { at: new Date(), lon: null, lat: null };
	await expect(
		addWalkPhoto(ana, {
			...base,
			clientId: 'foto-mala-1',
			startedAt: STARTED,
			file: new TextEncoder().encode('%PDF-1.7')
		})
	).rejects.toThrow(NotADocument);
	expect(
		await addWalkPhoto(ana, {
			...base,
			clientId: 'foto-sin-1',
			startedAt: new Date('2020-01-01'),
			file: JPEG
		})
	).toBe(false);
	expect(files.size).toBe(0);
});

test('an account taken: the files of what was only theirs, and no one else’s', async () => {
	await aWalk();
	const base = { at: new Date(), lon: null, lat: null, startedAt: STARTED };
	await addWalkPhoto(ana, { ...base, clientId: 'foto-ana-1', file: JPEG });
	await addRecordedNote(ana, anaWho, recording());
	await addRecordedNote(kitchen('luis'), { id: 'luis', email: 'l@example.test' }, recording());
	await addSaidNote(ana, 'ana', 'Sin audio');
	const files = await personFiles(ana, 'ana');
	expect(files.map((f) => f.area).sort()).toEqual(['notas', 'paseos']);
	await removePersonFiles(ana, files);
	expect(files.length).toBe(2);
	expect([...(await personFiles(ana, 'luis'))].length).toBe(1);
});
