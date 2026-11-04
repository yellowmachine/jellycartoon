import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { eq as sqlEq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '#lib/server/db/schema.ts';
import { family, paper } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { parsePaperInput } from 'comun/papers.ts';

/**
 * Papeles (#384) on PGlite, with the family's files and its sealing faked (the sealing itself, in
 * envelope.test.ts): what matters here is that nothing is kept as it came.
 */
const files = new Map<string, Uint8Array>();
const at = (familyId: string, area: string, name: string) => `${familyId}/${area}/${name}`;
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async (familyId: string, area: string, name: string, body: Uint8Array) =>
		void files.set(at(familyId, area, name), body),
	readFile: async (familyId: string, area: string, name: string) =>
		files.get(at(familyId, area, name)) ?? null,
	removeFile: async (familyId: string, area: string, name: string) =>
		void files.delete(at(familyId, area, name)),
	renameFile: async () => {},
	listFiles: async () => [],
	fileResponse: async () => new Response()
}));

const flip = (bytes: Uint8Array) => bytes.map((b) => b ^ 0xff);
let kmsDown = false;
mock.module('#lib/server/family-secret.ts', () => ({
	kmsOn: true,
	checkKms: async () => null,
	sealedNow: () => true,
	sealFor: async (_: string, text: string) => {
		if (kmsDown) throw new Error('KMS caído');
		return `kms1.${Buffer.from(text).toString('base64')}`;
	},
	openFor: async (_: string, value: string) =>
		kmsDown ? null : Buffer.from(value.slice(5), 'base64').toString(),
	sealFileFor: async (_: string, bytes: Uint8Array) => {
		if (kmsDown) throw new Error('KMS caído');
		return flip(bytes);
	},
	openFileFor: async (_: string, bytes: Uint8Array) => (kmsDown ? null : flip(bytes))
}));

const { addPaper, deletePaper, familyPapers, NotAPaper, paperFile, updatePaper } =
	await import('./papers.ts');

const db = drizzle(new PGlite(), { schema });
const a: Kitchen = {
	familyId: 'A',
	userId: null,
	run: (fn) => db.transaction((tx) => fn(tx))
};

const PDF = new TextEncoder().encode('%PDF-1.7 contrato');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const rent = {
	name: 'Contrato de alquiler',
	category: 'Casa',
	notes: 'Fianza de dos meses'
} as const;

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
});

describe('parsePaperInput', () => {
	test('well formed: trimmed, with its notes', () => {
		expect(parsePaperInput({ name: ' Póliza ', category: 'Seguros', notes: ' hola ' })).toEqual({
			name: 'Póliza',
			category: 'Seguros',
			notes: 'hola'
		});
	});

	test('notes may be left out, not its name or its category', () => {
		expect(parsePaperInput({ name: 'Póliza', category: 'Seguros' })?.notes).toBe('');
		expect(parsePaperInput({ name: ' ', category: 'Seguros' })).toBeNull();
		expect(parsePaperInput({ name: 'Póliza', category: 'Nada' })).toBeNull();
	});
});

describe('papers', () => {
	test('kept sealed: neither its name, notes nor file as they came', async () => {
		const id = await addPaper(a, rent, PDF);
		const [row] = await db.select().from(paper).where(eqId(id));
		expect(row!.name).not.toContain('Contrato');
		expect(row!.notes).not.toContain('Fianza');
		const kept = files.get(at('A', 'papeles', row!.file))!;
		expect(Buffer.from(kept).includes(Buffer.from('%PDF'))).toBe(false);
		await deletePaper(a, id);
	});

	test('read back, sorted by name, and its file as it came', async () => {
		const second = await addPaper(a, { name: 'Zapatos', category: 'Otros', notes: '' }, JPEG);
		const first = await addPaper(a, rent, PDF);
		const papers = await familyPapers(a);
		expect(papers.map((p) => p.name)).toEqual(['Contrato de alquiler', 'Zapatos']);
		expect(papers[0]).toMatchObject({
			notes: 'Fianza de dos meses',
			file: 'pdf',
			category: 'Casa'
		});
		expect(papers[1]).toMatchObject({ notes: null, file: 'image' });
		const file = await paperFile(a, first);
		expect(file).toMatchObject({ type: 'application/pdf', name: 'Contrato de alquiler' });
		expect(file!.bytes).toEqual(PDF);
		await deletePaper(a, first);
		await deletePaper(a, second);
	});

	test('what is not a PDF or a picture is not kept', async () => {
		const before = files.size;
		await expect(addPaper(a, rent, new TextEncoder().encode('hola'))).rejects.toBeInstanceOf(
			NotAPaper
		);
		expect(files.size).toBe(before);
	});

	test('corrected: its notes alone keep its file; another file, the old one out', async () => {
		const id = await addPaper(a, rent, PDF);
		const first = (await db.select().from(paper).where(eqId(id)))[0]!.file;
		expect(await updatePaper(a, id, { ...rent, notes: '' })).toBe(true);
		let [row] = await db.select().from(paper).where(eqId(id));
		expect(row!.file).toBe(first);
		expect(row!.notes).toBeNull();
		expect(await updatePaper(a, id, rent, JPEG)).toBe(true);
		[row] = await db.select().from(paper).where(eqId(id));
		expect(row!.file.endsWith('.jpg')).toBe(true);
		expect(files.has(at('A', 'papeles', first))).toBe(false);
		await deletePaper(a, id);
		expect(files.has(at('A', 'papeles', row!.file))).toBe(false);
	});

	test('one no longer there: false', async () => {
		expect(await updatePaper(a, 99999, rent)).toBe(false);
		expect(await deletePaper(a, 99999)).toBe(false);
		expect(await paperFile(a, 99999)).toBeNull();
	});

	test('the KMS down: nothing kept, and what is kept not read', async () => {
		const id = await addPaper(a, rent, PDF);
		const before = files.size;
		kmsDown = true;
		try {
			await expect(addPaper(a, rent, PDF)).rejects.toThrow('KMS caído');
			expect(files.size).toBe(before);
			const [read] = await familyPapers(a);
			expect(read!.name).toBeNull();
			expect(await paperFile(a, id)).toBeNull();
		} finally {
			kmsDown = false;
		}
		await deletePaper(a, id);
	});
});

function eqId(id: number) {
	return sqlEq(paper.id, id);
}
