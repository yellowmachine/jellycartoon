import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { makeZip } from 'client-zip';
import { unzipSync, strFromU8 } from 'fflate';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '#lib/server/db/schema.ts';
import {
	calendarEvent,
	calendarEventPerson,
	expense,
	family,
	familyMember,
	familyPerson,
	medication,
	medicationDose,
	memory,
	note,
	paper,
	paperPerson,
	plannedTrip,
	plannedTripPerson,
	pushSubscription,
	user,
	walk,
	walkPhoto
} from '#lib/server/db/schema.ts';
import { familyScope } from '#lib/server/family-scope.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/** A person's zip on PGlite, as the app's role, with the files and the family's key faked. */
const files = new Map<string, Uint8Array>();
const bytes = (text: string) => new TextEncoder().encode(text);
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async () => {},
	removeFile: async () => {},
	readFile: async (_f: string, area: string, name: string) => files.get(`${area}/${name}`) ?? null,
	listFiles: async () => [],
	fileResponse: async () => new Response()
}));
mock.module('#lib/server/family-secret.ts', () => ({
	kmsOn: true,
	sealFor: async (_f: string, text: string) => `sellado:${text}`,
	openFor: async (_f: string, text: string) => {
		if (text.includes('roto')) throw new Error('KMS');
		return text.replace('sellado:', '');
	},
	sealFileFor: async (_f: string, file: Uint8Array) => file,
	openFileFor: async (_f: string, file: Uint8Array) =>
		bytes(new TextDecoder().decode(file).replace('sellado:', ''))
}));

const { myDataFiles, readMyData } = await import('#lib/server/my-data.ts');

const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const kitchen = (userId: string): Kitchen => ({
	familyId: 'A',
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

async function zipOf(userId: string) {
	const k = kitchen(userId);
	const stream = makeZip(myDataFiles(k, await readMyData(k, userId)));
	const all = unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()));
	return {
		names: Object.keys(all).sort(),
		text: (name: string) => strFromU8(all[name]),
		json: (name: string) => JSON.parse(strFromU8(all[name]))
	};
}

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(user).values(['ana', 'luis', 'berta'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'luis', familyId: 'A', role: 'member' },
		{ userId: 'berta', familyId: 'B', role: 'admin' }
	]);
	await db.insert(familyPerson).values([
		{ id: 1, familyId: 'A', userId: 'ana', name: 'Ana' },
		{ id: 2, familyId: 'A', userId: 'luis', name: 'Luis' },
		{ id: 3, familyId: 'A', userId: null, name: 'Peque' },
		{ id: 4, familyId: 'B', userId: 'berta', name: 'Berta' }
	]);

	// Hers, and of whom it is for, whoever wrote it down.
	const dose = { startDay: '2026-11-01', times: ['09:00'] };
	await db.insert(medication).values([
		{ id: 1, familyId: 'A', personId: 1, name: 'La de Ana', userId: 'luis', ...dose },
		{ id: 2, familyId: 'A', personId: 3, name: 'La de Peque', userId: 'ana', ...dose },
		{ id: 3, familyId: 'A', personId: 2, name: 'La de Luis', userId: 'luis', ...dose }
	]);
	await db.insert(medicationDose).values([
		{ familyId: 'A', medicationId: 1, day: '2026-11-01', time: '09:00' },
		{ familyId: 'A', medicationId: 3, day: '2026-11-01', time: '09:00' }
	]);

	// An event for her, one she wrote, one of others; only her row of who goes.
	await db.insert(calendarEvent).values([
		{ id: 1, familyId: 'A', title: 'Para las dos', startDay: '2026-11-02', userId: 'luis' },
		{ id: 2, familyId: 'A', title: 'Escrita por Ana', startDay: '2026-11-03', userId: 'ana' },
		{ id: 3, familyId: 'A', title: 'De Luis', startDay: '2026-11-04', userId: 'luis' }
	]);
	await db.insert(calendarEventPerson).values([
		{ familyId: 'A', eventId: 1, personId: 1 },
		{ familyId: 'A', eventId: 1, personId: 2 },
		{ familyId: 'A', eventId: 3, personId: 2 }
	]);

	await db.insert(memory).values([
		{ familyId: 'A', userId: 'ana', text: 'Recuerdo de Ana', words: [] },
		{ familyId: 'A', userId: 'luis', text: 'Recuerdo de Luis', words: [] },
		{ familyId: 'A', userId: null, text: 'Recuerdo de la casa', words: [] }
	]);

	// Papers: sealed, hers by who uploaded it or whom it is for.
	const sealedPaper = { familyId: 'A', category: 'otros', notes: 'sellado:una nota' };
	await db.insert(paper).values([
		{ id: 1, name: 'sellado:DNI', file: 'dni.pdf', userId: 'ana', ...sealedPaper },
		{ id: 2, name: 'sellado:Para Ana', file: 'para.pdf', userId: 'luis', ...sealedPaper },
		{ id: 3, name: 'sellado:De Luis', file: 'luis.pdf', userId: 'luis', ...sealedPaper },
		{ id: 4, name: 'roto', file: 'falta.pdf', userId: 'ana', ...sealedPaper }
	]);
	await db.insert(paperPerson).values({ familyId: 'A', paperId: 2, personId: 1 });
	files.set('papeles/dni.pdf', bytes('sellado:el dni'));
	files.set('papeles/para.pdf', bytes('sellado:el otro'));
	files.set('papeles/luis.pdf', bytes('sellado:de luis'));

	// Files, by their column, with a path or not, and a name that is its id.
	const at = new Date('2026-11-05T10:00:00Z');
	await db.insert(note).values({
		familyId: 'A',
		userId: 'ana',
		at,
		text: 'Nota',
		audio: 'nota.webm',
		clientId: 'c1',
		source: 'pagina'
	});
	files.set('notas/nota.webm', bytes('audio'));
	await db.insert(walk).values({
		id: 1,
		familyId: 'A',
		userId: 'ana',
		startedAt: at,
		endedAt: at,
		diagnosis: {} as never
	});
	await db
		.insert(walkPhoto)
		.values({ familyId: 'A', userId: 'ana', walkId: 1, clientId: 'c', file: 'p.jpg', at });
	files.set('paseos/p.jpg', bytes('foto'));
	await db.insert(expense).values({
		familyId: 'A',
		date: '2026-11-01',
		store: 'Tienda',
		total: 100,
		category: 'otros',
		source: 'mano',
		userId: 'ana',
		receipt: '/gastos/ticket.jpg'
	});
	files.set('gastos/ticket.jpg', bytes('ticket'));

	// Another's private trip, though she is on it; hers, private.
	await db.insert(plannedTrip).values([
		{ id: 1, familyId: 'A', name: 'Privado de Luis', private: true, userId: 'luis' },
		{ id: 2, familyId: 'A', name: 'Privado de Ana', private: true, userId: 'ana' }
	]);
	await db.insert(plannedTripPerson).values({ familyId: 'A', tripId: 1, personId: 1 });

	await db.insert(pushSubscription).values({
		familyId: 'A',
		userId: 'ana',
		endpoint: 'https://push/ana',
		p256dh: 'secreto',
		auth: 'secreto'
	});
});

test('its medication: for her, whoever wrote it, with its doses; not what she wrote for others', async () => {
	const zip = await zipOf('ana');
	expect(zip.json('datos/medicacion.json').map((m: { name: string }) => m.name)).toEqual([
		'La de Ana'
	]);
	expect(zip.json('datos/medicacion-tomas.json')).toHaveLength(1);
});

test('events for her or written by her, and only her row of who goes', async () => {
	const zip = await zipOf('ana');
	const titles = zip.json('datos/citas.json').map((e: { title: string }) => e.title);
	expect(titles.sort()).toEqual(['Escrita por Ana', 'Para las dos']);
	expect(zip.json('datos/citas-personas.json')).toEqual([
		{ familyId: 'A', eventId: 1, personId: 1 }
	]);
});

test('the voice: hers, not another’s nor the whole house’s', async () => {
	const zip = await zipOf('ana');
	expect(zip.json('datos/recuerdos.json').map((m: { text: string }) => m.text)).toEqual([
		'Recuerdo de Ana'
	]);
});

test('papers opened, uploaded by her or for her; what cannot be read is said', async () => {
	const zip = await zipOf('ana');
	const names = zip.json('datos/papeles.json').map((p: { name: string }) => p.name);
	expect(names.sort()).toEqual(['(no se pudo descifrar)', 'DNI', 'Para Ana']);
	expect(zip.json('datos/papeles.json')[0].notes).toBe('una nota');
	expect(zip.text('archivos/papeles/dni.pdf')).toBe('el dni');
	expect(zip.text('archivos/papeles/para.pdf')).toBe('el otro');
	expect(zip.names).not.toContain('archivos/papeles/luis.pdf');
	expect(zip.text('FALTAN.txt')).toContain('archivos/papeles/falta.pdf');
	expect(zip.text('FALTAN.txt')).toContain('datos/papeles.json');
});

test('its files, by their columns', async () => {
	const zip = await zipOf('ana');
	expect(zip.text('archivos/notas/nota.webm')).toBe('audio');
	expect(zip.text('archivos/paseos/p.jpg')).toBe('foto');
	expect(zip.text('archivos/gastos/ticket.jpg')).toBe('ticket');
});

test('another’s private trip does not go, though she is on it; hers does', async () => {
	const zip = await zipOf('ana');
	expect(zip.json('datos/viajes-planificados.json').map((t: { name: string }) => t.name)).toEqual([
		'Privado de Ana'
	]);
});

test('no keys, and the account without its secrets', async () => {
	const zip = await zipOf('ana');
	expect(zip.names.some((n) => n.includes('push'))).toBe(false);
	const everything = zip.names.map((n) => (n.endsWith('.json') ? zip.text(n) : '')).join('');
	expect(everything).not.toContain('secreto');
	expect(Object.keys(zip.json('cuenta.json')).sort()).toEqual([
		'createdAt',
		'email',
		'emailVerified',
		'name'
	]);
	expect(zip.names).toContain('LEEME.txt');
});

test('someone with nothing of a kind gets no file of it, and nothing of hers', async () => {
	const zip = await zipOf('luis');
	expect(zip.names).not.toContain('FALTAN.txt');
	expect(zip.names).not.toContain('datos/notas.json');
	const everything = zip.names.map((n) => (n.endsWith('.json') ? zip.text(n) : '')).join('');
	expect(everything).not.toContain('Recuerdo de Ana');
});
