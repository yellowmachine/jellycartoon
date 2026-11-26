import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '#lib/server/db/schema.ts';
import { family, note, user, walk, walkPhoto } from '#lib/server/db/schema.ts';
import { notesAndPhotos, photoMoment, type Note, type NoteArticle } from '#lib/notes.ts';
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
	},
	// chat.test.ts's, unused here: a mock's names are fixed by the first one.
	toBuy: async () => [],
	addItems: async () => []
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => null }));
// «Para leer» (#634): the webs' articles, as if read (notes-reader.test.ts reads for real).
const articles = new Map<string, NoteArticle>();
mock.module('#lib/server/notes-reader.ts', () => ({
	readArticle: async (url: string) => articles.get(url) ?? null,
	safeArticleHtml: (html: string) => html,
	articleOf: () => null
}));

const {
	addRecordedNote,
	addSaidNote,
	addWebNote,
	addWrittenNote,
	deleteNote,
	deleteWalkNotes,
	describeNotes,
	editNote,
	hearAgain,
	listNotes,
	noteAudio,
	noteArticle,
	notePhoto,
	noteTags,
	NotAPhoto,
	setNoteTags,
	shareNote,
	NotAudio,
	walkNotes
} = await import('./notes.ts');
const {
	addWalkPhoto,
	deleteWalk,
	deleteWalkPhoto,
	deleteWalkPhotos,
	listWalkPhotos,
	walkPhotoFile,
	walkPhotos
} = await import('./walks/walks.ts');
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
	expect(await addWrittenNote(ana, 'ana', { text: '   ', photo: null, shared: false })).toBeNull();
});

test('deleted: its audio goes', async () => {
	await addRecordedNote(ana, anaWho, recording());
	const [mine] = await listNotes(ana, 'ana', null);
	await deleteNote(ana, 'ana', mine!.id);
	expect(await listNotes(ana, 'ana', null)).toHaveLength(0);
	expect(files.size).toBe(0);
});

test('a walk deleted: its photos and notes stay; or go, if it is asked (#613)', async () => {
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
	expect(await listWalkPhotos(ana)).toMatchObject([{ id: photo!.id, walkId: null }]);
	expect(await listWalkPhotos(kitchen('luis'))).toHaveLength(0);
	expect(files.size).toBe(2);
	await deleteWalkPhoto(kitchen('luis'), photo!.id);
	expect(await listWalkPhotos(ana)).toHaveLength(1);
	await deleteWalkPhoto(ana, photo!.id);
	expect(await db.select().from(walkPhoto)).toHaveLength(0);
	const [kept] = await listNotes(ana, 'ana', null);
	expect(kept).toMatchObject({ text: 'Llamar al fontanero', lon: -1.1, hasAudio: true });
	expect([...files.keys()].every((name) => name.startsWith('notas/'))).toBe(true);

	const again = await aWalk();
	await addWalkPhoto(ana, { ...base, clientId: 'foto-dos-22', file: JPEG });
	await addRecordedNote(ana, anaWho, recording({ walkStarted: STARTED, clientId: 'otra-nota-2' }));
	await deleteWalkNotes(kitchen('luis'), 'luis', again);
	await deleteWalkPhotos(kitchen('luis'), again);
	expect(await walkNotes(ana, again)).toHaveLength(1);
	expect(await walkPhotos(ana, again)).toHaveLength(1);
	await deleteWalkNotes(ana, 'ana', again);
	await deleteWalkPhotos(ana, again);
	expect(await walkPhotos(ana, again)).toHaveLength(0);
	// Only the first walk's note is left.
	expect(await listNotes(ana, 'ana', null)).toHaveLength(1);
	expect(files.size).toBe(1);
});

test('a photo note: when and where it was taken; shared, where is only told to its person', async () => {
	const at = new Date('2026-11-03T11:00:00Z');
	await addWrittenNote(ana, 'ana', {
		text: 'Mirador',
		photo: JPEG,
		shared: true,
		at,
		position: [-1.1, 37.9]
	});
	const [mine] = await listNotes(ana, 'ana', null);
	expect(mine).toMatchObject({ at, lat: expect.closeTo(37.9, 3) });
	const [theirs] = await listNotes(kitchen('luis'), 'luis', null);
	expect(theirs).toMatchObject({ text: 'Mirador', lon: null, lat: null });
});

test('Notas: the walks’ photos by walk, where their latest is', () => {
	const at = (h: number) => new Date(Date.UTC(2026, 10, 5, h));
	const note = (id: number, h: number) => ({ id, at: at(h) }) as Note;
	const items = notesAndPhotos(
		[note(1, 12), note(2, 8)],
		[
			{ id: 1, walkId: 7, at: at(11) },
			{ id: 2, walkId: 7, at: at(10) },
			{ id: 3, walkId: null, at: at(9) },
			{ id: 4, walkId: 8, at: at(6) }
		],
		(d) => d.toISOString().slice(0, 10)
	);
	expect(items.map((i) => i.key)).toEqual([
		'nota-1',
		'paseo-7',
		'dia-2026-11-05',
		'nota-2',
		'paseo-8'
	]);
	expect(items[1]).toMatchObject({ photos: [{ id: 2 }, { id: 1 }] });
	expect(
		notesAndPhotos([note(1, 12), note(2, 8)], [{ id: 4, walkId: 8, at: at(6) }], String, 2)
	).toHaveLength(2);
	expect(photoMoment(Date.now() + 3_600_000)).toBeNull();
	expect(photoMoment(Number('x'))).toBeNull();
	expect(photoMoment(at(6).getTime())).toEqual(at(6));
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

test('written by hand: own, found, marked as written, with nothing to hear', async () => {
	await addWrittenNote(ana, 'ana', { text: '  Comprar sellos  ', photo: null, shared: false });
	const [found] = await listNotes(ana, 'ana', 'sellos');
	expect(found).toMatchObject({
		text: 'Comprar sellos',
		source: 'escrita',
		hasAudio: false,
		mine: true
	});
	expect(await listNotes(kitchen('luis'), 'luis', 'sellos')).toEqual([]);
});

test('with a photo: its words may be missing; deleted, its file goes', async () => {
	await addWrittenNote(ana, 'ana', { text: '', photo: JPEG, shared: false });
	const [n] = await listNotes(ana, 'ana', null);
	expect(n).toMatchObject({ text: '', mine: true, shared: false, canEdit: true });
	expect(n!.photo).toStartWith(`/notas/${n!.id}/foto?v=`);
	expect(files.has(`notas/${await notePhoto(ana, 'ana', n!.id)}`)).toBe(true);
	expect(await notePhoto(kitchen('luis'), 'luis', n!.id)).toBeNull();
	expect((await personFiles(ana, 'ana')).map((f) => f.area)).toEqual(['notas']);
	await deleteNote(ana, 'ana', n!.id);
	expect(files.size).toBe(0);
	await expect(
		addWrittenNote(ana, 'ana', {
			text: 'x',
			photo: new TextEncoder().encode('%PDF-1.7'),
			shared: false
		})
	).rejects.toThrow(NotAPhoto);
});

test('shared: the house sees it, only its person changes it, and can take it back', async () => {
	const luis = kitchen('luis');
	await addWrittenNote(ana, 'ana', { text: 'La caldera', photo: JPEG, shared: true });
	await addWrittenNote(ana, 'ana', { text: 'Privada', photo: null, shared: false });
	const [n] = await listNotes(luis, 'luis', null);
	expect(await listNotes(luis, 'luis', null)).toHaveLength(1);
	expect(n).toMatchObject({ mine: false, shared: true, author: 'ana', canEdit: false });
	expect(await notePhoto(luis, 'luis', n!.id)).not.toBeNull();
	expect((await listNotes(ana, 'ana', null, { house: true })).map((x) => x.text)).toEqual([
		'La caldera'
	]);
	const asked = { words: null, fromDay: null, untilDay: null };
	expect(await describeNotes(luis, 'luis', asked)).toEndWith(' (de ana): La caldera (con foto)');
	expect(await editNote(luis, 'luis', n!.id, 'Otra')).toBe(false);
	expect(await shareNote(luis, 'luis', n!.id, false)).toBe(false);
	await deleteNote(luis, 'luis', n!.id);
	expect(files.size).toBe(1);
	expect(await shareNote(ana, 'ana', n!.id, false)).toBe(true);
	expect(await listNotes(luis, 'luis', null)).toHaveLength(0);
	expect(await notePhoto(luis, 'luis', n!.id)).toBeNull();
});

test('«Para leer» (#634): a web with its article, apart; found by what it says; and their tags', async () => {
	articles.set('https://pan.es/masa-madre', {
		title: 'Pan de masa madre',
		byline: 'Ana',
		site: 'Pan',
		html: '<p>Harina, agua y paciencia.</p>',
		text: 'Harina, agua y paciencia: el centeno ayuda.',
		minutes: 4
	});
	const read = await addWebNote(ana, 'ana', {
		link: 'https://pan.es/masa-madre',
		title: '',
		tags: ['cocina']
	});
	expect(read.read).toBe(true);
	// A paywall: kept with its name and link, no article.
	const paid = await addWebNote(ana, 'ana', { link: 'https://diario.es/pago', title: 'De pago' });
	expect(paid.read).toBe(false);
	await addWrittenNote(ana, 'ana', {
		text: 'Comprar centeno',
		photo: null,
		shared: false,
		tags: ['cocina', 'compra']
	});

	const titles = async (filter: Parameters<typeof listNotes>[3], words: string | null = null) =>
		(await listNotes(ana, 'ana', words, filter)).map((x) => x.text).sort();
	expect(await titles({ pages: true })).toEqual(['De pago', 'Pan de masa madre']);
	expect(await titles({ pages: false })).toEqual(['Comprar centeno']);
	// What the article says, too; accents aside.
	expect(await titles({}, 'CENTÉNO')).toEqual(['Comprar centeno', 'Pan de masa madre']);
	expect(await titles({ tag: 'compra' })).toEqual(['Comprar centeno']);

	const [web] = await listNotes(ana, 'ana', null, { pages: true, tag: 'cocina' });
	expect(web).toMatchObject({
		link: 'https://pan.es/masa-madre',
		article: { minutes: 4, site: 'Pan' },
		tags: ['cocina']
	});
	expect((await noteArticle(ana, 'ana', read.id))!.article!.html).toBe(
		'<p>Harina, agua y paciencia.</p>'
	);
	expect((await noteArticle(ana, 'ana', paid.id))!.article).toBeNull();
	// Another's, not shared: neither seen nor changed.
	expect(await noteArticle(kitchen('luis'), 'luis', read.id)).toBeNull();
	expect(await setNoteTags(kitchen('luis'), 'luis', read.id, ['mía'])).toBe(false);

	expect(await noteTags(ana, 'ana')).toEqual(['cocina', 'compra']);
	expect(await noteTags(kitchen('luis'), 'luis')).toEqual([]);
});
