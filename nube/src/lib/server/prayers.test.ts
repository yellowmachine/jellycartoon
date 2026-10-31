import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, user } from './db/schema.ts';
import { familyOnlyScope, familyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';

/**
 * Oración (#339), on a real Postgres (PGlite) as the app's role: voices, texts and lists of each
 * family only, and a text's voice made in the background (OpenRouter and the files, faked; ffmpeg,
 * the real one, if it is there).
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const asFamily = familyOnlyScope(db, { role: 'app_user' });

const files = new Map<string, Uint8Array>();
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async (f: string, area: string, name: string, body: Uint8Array) =>
		void files.set(`${f}/${area}/${name}`, body),
	removeFile: async (f: string, area: string, name: string) =>
		void files.delete(`${f}/${area}/${name}`),
	readFile: async (f: string, area: string, name: string) =>
		files.get(`${f}/${area}/${name}`) ?? null,
	listFiles: async (f: string, area: string) =>
		[...files.keys()]
			.filter((key) => key.startsWith(`${f}/${area}/`))
			.map((key) => key.slice(`${f}/${area}/`.length))
}));
const said: { input: string; voice: string; instructions?: string }[] = [];
let refuse: string | null = null;
// The real one: a mock is the whole process's, and openrouter.test.ts tests it.
const { sayableError } = await import('#lib/server/openrouter.ts');
mock.module('#lib/server/openrouter.ts', () => ({
	// homework.test.ts's, unused here: a mock is the whole process's.
	completeJson: async () => ({}),
	sayableError,
	speech: async (r: { input: string; voice: string; instructions?: string }) => {
		if (refuse) throw new Error(refuse);
		said.push(r);
		// A second of silence at 24 kHz.
		return { pcm: new Uint8Array(48_000), rate: 24_000 };
	}
}));

const p = await import('./prayers.ts');

const kitchen = (userId: string, familyId: string): Kitchen => ({
	familyId,
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});
const ana = kitchen('ana', 'A');
const otro = kitchen('otro', 'B');

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
	await db.insert(user).values(
		['ana', 'otro'].map((id) => ({
			id,
			name: id,
			email: `${id}@test.es`,
			createdAt: new Date(),
			updatedAt: new Date()
		}))
	);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'otro', familyId: 'B', role: 'admin' }
	]);
});

/** Until its voice is no longer being made. */
async function settled(k: Kitchen, id: number) {
	for (let i = 0; i < 200; i++) {
		const found = (await p.listPrayers(k)).find((x) => x.id === id)!;
		if (found.status !== 'generando') return found;
		await Bun.sleep(25);
	}
	throw new Error('Sigue generando');
}

const hasFfmpeg = Boolean(Bun.which('ffmpeg'));

describe('Oración', () => {
	let voice = 0;
	let other = 0;
	let padre = 0;

	test('off until it is turned on, for its family only', async () => {
		expect(await p.prayerModeOn(ana)).toBe(false);
		await p.setPrayerMode(ana, true);
		expect(await p.prayerModeOn(ana)).toBe(true);
		expect(await p.prayerModeOn(otro)).toBe(false);
	});

	test('voices, each family its own', async () => {
		voice = (await p.saveVoice(ana, null, { name: 'Rosario', voice: 'Charon', tone: 'Pausado' }))!;
		other = (await p.saveVoice(otro, null, { name: 'Suya', voice: 'Kore', tone: '' }))!;
		expect((await p.listVoices(ana)).map((v) => v.name)).toEqual(['Rosario']);
		expect(await p.saveVoice(ana, other, { name: 'Mía', voice: 'Kore', tone: '' })).toBeNull();
	});

	test('a text, only with a voice of its own family; without its voice yet', async () => {
		const input = {
			title: 'Padre nuestro',
			text: 'Padre nuestro,\nque estás en el cielo.',
			voiceId: other
		};
		expect(await p.savePrayer(ana, null, input)).toBeNull();
		padre = (await p.savePrayer(ana, null, { ...input, voiceId: voice }))!;
		const [found] = await p.listPrayers(ana);
		expect(found).toMatchObject({ id: padre, status: 'pendiente', audioUrl: null });
		expect(await p.listPrayers(otro)).toEqual([]);
	});

	test('a voice in use is not deleted', async () => {
		expect((await p.listVoices(ana))[0].uses).toBe(1);
		expect(await p.deleteVoice(ana, voice)).toBe(false);
	});

	test.skipIf(!hasFfmpeg)(
		'its voice made, kept, and «cambiada» once its text changes',
		async () => {
			expect(await p.generatePrayer(ana, padre, 'sk-test')).toBeNull();
			const done = await settled(ana, padre);
			expect(done.status).toBe('lista');
			expect(done.durationSec).toBeCloseTo(1, 1);
			expect(said.at(-1)).toMatchObject({ voice: 'Charon', instructions: 'Pausado' });
			const kept = [...files.keys()];
			expect(kept).toHaveLength(1);
			expect(kept[0]).toStartWith(`A/oracion/${padre}-`);
			// Ogg.
			expect(new TextDecoder().decode(files.get(kept[0])!.subarray(0, 4))).toBe('OggS');
			expect(await p.prayerAudioFile(otro, padre)).toBeNull();
			// By the family's pass (the house's mpv, #339): the family alone, no person.
			const byPass = (familyId: string): Kitchen => ({
				familyId,
				userId: null,
				run: (fn) => asFamily(familyId, fn)
			});
			expect(await p.prayerAudioFile(byPass('A'), padre)).toBe(kept[0].split('/').at(-1)!);
			expect(await p.prayerAudioFile(byPass('B'), padre)).toBeNull();
			expect(await p.prayerModeOn(byPass('A'))).toBe(true);

			await p.savePrayer(ana, padre, {
				title: 'Padre nuestro',
				text: 'Pater noster',
				voiceId: voice
			});
			const changed = (await p.listPrayers(ana))[0];
			expect(changed.status).toBe('cambiada');
			expect(changed.audioUrl).not.toBeNull();

			// Made again: the old recording out.
			await p.generatePrayer(ana, padre, 'sk-test');
			expect((await settled(ana, padre)).status).toBe('lista');
			expect(files.size).toBe(1);
			expect([...files.keys()][0]).not.toBe(kept[0]);
		}
	);

	test.skipIf(!hasFfmpeg)('a voice tried: read and given back, not kept', async () => {
		const before = files.size;
		const ogg = await p.tryVoice('A', 'sk-test', { voice: 'Leda', tone: 'Alegre' }, 'Hola');
		expect(new TextDecoder().decode(ogg.subarray(0, 4))).toBe('OggS');
		expect(said.at(-1)).toMatchObject({ input: 'Hola', voice: 'Leda', instructions: 'Alegre' });
		expect(files.size).toBe(before);
	});

	test('a refused voice says why, and the recording before stays', async () => {
		refuse = 'No queda saldo en OpenRouter';
		await p.savePrayer(ana, padre, {
			title: 'Padre nuestro',
			text: 'Pater noster!',
			voiceId: voice
		});
		await p.generatePrayer(ana, padre, 'sk-test');
		const failed = await settled(ana, padre);
		refuse = null;
		expect(failed).toMatchObject({ status: 'error', error: 'No queda saldo en OpenRouter' });
		if (hasFfmpeg) expect(failed.audioUrl).not.toBeNull();
	});

	test('a lost recording (a restart) is an error, not «generando» for ever', () => {
		const row = {
			generatingSince: new Date(Date.now() - 20 * 60_000),
			audioError: null,
			audioFile: null
		};
		expect(p.statusOf(row as never, undefined)).toBe('error');
	});

	test('lists: in order, with their times; a text of another family, refused', async () => {
		const ave = (await p.savePrayer(ana, null, {
			title: 'Ave María',
			text: 'Dios te salve, María',
			voiceId: voice
		}))!;
		const suyo = (await p.savePrayer(otro, null, { title: 'X', text: 'x', voiceId: other }))!;
		const input = (items: { prayerId: number; times: number }[]) =>
			p.parseListInput({ title: ' Rosario ', pauseSec: 99, items })!;
		expect(await p.saveList(ana, null, input([{ prayerId: suyo, times: 1 }]))).toBeNull();
		const id = (await p.saveList(
			ana,
			null,
			input([
				{ prayerId: padre, times: 1 },
				{ prayerId: ave, times: 10 }
			])
		))!;
		expect(await p.listLists(ana)).toEqual([
			{
				id,
				title: 'Rosario',
				pauseSec: 30,
				items: [
					{ prayerId: padre, times: 1 },
					{ prayerId: ave, times: 10 }
				]
			}
		]);
		await p.saveList(
			ana,
			id,
			input([
				{ prayerId: ave, times: 3 },
				{ prayerId: padre, times: 1 }
			])
		);
		expect((await p.listLists(ana))[0].items).toEqual([
			{ prayerId: ave, times: 3 },
			{ prayerId: padre, times: 1 }
		]);
		expect(await p.listLists(otro)).toEqual([]);

		// A text deleted leaves its lists, and its recording goes.
		await p.deletePrayer(ana, padre);
		expect((await p.listLists(ana))[0].items).toEqual([{ prayerId: ave, times: 3 }]);
		expect([...files.keys()].some((k) => k.startsWith(`A/oracion/${padre}-`))).toBe(false);
	});

	test('what a list sends is kept within its limits', () => {
		expect(p.parseListInput({ title: '', items: [] })).toBeNull();
		expect(p.parseListInput({ title: 'L', items: [{ prayerId: 'x', times: 1 }] })).toBeNull();
		expect(
			p.parseListInput({ title: 'L', pauseSec: -4, items: [{ prayerId: 1, times: 0 }] })
		).toEqual({
			title: 'L',
			pauseSec: 0,
			items: [{ prayerId: 1, times: 1 }]
		});
	});
});
