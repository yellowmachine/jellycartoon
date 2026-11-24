import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '#lib/server/db/schema.ts';
import { family } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/** The photos of the shopping list, with the real fridge, on PGlite; the files, faked. */
const files = new Map<string, Uint8Array>();
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async (_f: string, area: string, name: string, body: Uint8Array) =>
		void files.set(`${area}/${name}`, body),
	removeFile: async (_f: string, area: string, name: string) =>
		void files.delete(`${area}/${name}`),
	readFile: async () => null,
	listFiles: async () => [],
	refused: () => null,
	fileResponse: async () => new Response()
}));
mock.module('#lib/server/family.ts', () => ({
	asFamily: () => {
		throw new Error('Sin familia en esta prueba');
	},
	withFamily: () => {
		throw new Error('Sin familia en esta prueba');
	}
}));
mock.module('#lib/server/agenda/agenda.ts', () => ({
	agendaToday: async () => ({ day: '2026-11-24', events: [], people: [] })
}));
mock.module('#lib/server/rule-events.ts', () => ({ ruleEvent: () => {} }));

const { addItems, clearDone, fridgeState, removeItem, setItemDone } = await import('./fridge.ts');
const { NotAPhoto, removeShoppingPhoto, setPhotoNote, setShoppingPhoto, shoppingPhotoFile } =
	await import('./shopping-photos.ts');

const db = drizzle(new PGlite(), { schema });
const k: Kitchen = { familyId: 'A', userId: null, run: (fn) => db.transaction((tx) => fn(tx)) };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

const list = async () => (await fridgeState(k)).list.items;
const item = async () => (await list())[0]!;

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
});

beforeEach(async () => {
	files.clear();
	await db.execute(sql`truncate shopping_photo, fridge_item, fridge_note cascade`);
	await addItems(k, ['Jabón']);
});

test('remembered by its name when it is bought and put on the list again', async () => {
	expect((await item()).photo).toBeNull();
	expect(await setShoppingPhoto(k, (await item()).id, JPEG)).toBe(true);
	expect(await setPhotoNote(k, (await item()).id, ' el azul ')).toBe(true);
	await setItemDone(k, (await item()).id, true);
	await clearDone(k);
	expect(await list()).toEqual([]);
	await addItems(k, ['leche', 'jabon']);
	const [milk, soap] = await list();
	expect(milk!.photo).toBeNull();
	expect(soap!.photo).toMatchObject({ note: 'el azul' });
	const id = Number(soap!.photo!.url.match(/fotos\/(\d+)/)![1]);
	expect(files.has(`compra/${await shoppingPhotoFile(k, id)}`)).toBe(true);
});

test('another photo: the one before goes, its note stays', async () => {
	const { id } = await item();
	await setShoppingPhoto(k, id, JPEG);
	await setPhotoNote(k, id, 'el azul');
	const before = (await item()).photo!.url;
	await setShoppingPhoto(k, id, JPEG);
	expect(files.size).toBe(1);
	expect((await item()).photo!.url).not.toBe(before);
	expect((await item()).photo!.note).toBe('el azul');
});

test('taken off, with its file', async () => {
	const { id } = await item();
	await setShoppingPhoto(k, id, JPEG);
	await removeShoppingPhoto(k, id);
	expect((await item()).photo).toBeNull();
	expect(files.size).toBe(0);
	expect(await setPhotoNote(k, id, 'x')).toBe(false);
});

test('neither what is not a photo, nor of what is no longer on the list', async () => {
	const { id } = await item();
	await expect(setShoppingPhoto(k, id, new TextEncoder().encode('%PDF-1.7'))).rejects.toThrow(
		NotAPhoto
	);
	await removeItem(k, id);
	expect(await setShoppingPhoto(k, id, JPEG)).toBe(false);
	expect(files.size).toBe(0);
});
