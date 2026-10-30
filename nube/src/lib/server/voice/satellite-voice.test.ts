import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '#lib/server/db/schema.ts';
import { family } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * How Seilide's satellites speak (#296), on PGlite, with OpenRouter's speech faked: what it was
 * asked to say, and in which voice.
 */
const asked: { voice: string; input: string; instructions?: string }[] = [];
/** How many were being said at once, at most. */
let inFlight = 0;
let mostInFlight = 0;
mock.module('#lib/server/openrouter.ts', () => ({
	speech: async (r: { voice: string; input: string; instructions?: string }) => {
		asked.push(r);
		mostInFlight = Math.max(mostInFlight, ++inFlight);
		await new Promise((resolve) => setTimeout(resolve, 5));
		inFlight--;
		return { pcm: new Uint8Array(4), rate: 24_000 };
	}
}));

/** The family's files, faked: by area and name. */
const files = new Map<string, Uint8Array>();
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async (familyId: string, area: string, name: string, body: Uint8Array) =>
		void files.set(`${familyId}/${area}/${name}`, body),
	readFile: async (familyId: string, area: string, name: string) =>
		files.get(`${familyId}/${area}/${name}`) ?? null,
	removeFile: async (familyId: string, area: string, name: string) =>
		void files.delete(`${familyId}/${area}/${name}`)
}));

const { fillerSpeech, satelliteSpeech, satelliteVoiceOf, setSatelliteVoice, warmFillers } =
	await import('./satellite-voice.ts');

const db = drizzle(new PGlite(), { schema });
const k: Kitchen = { familyId: 'A', userId: null, run: (fn) => db.transaction((tx) => fn(tx)) };

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
});

describe('the satellites voice', () => {
	test('without one saved: Kore, its tone and the phrases of always', async () => {
		const voice = await satelliteVoiceOf(k);
		expect(voice.voice).toBe('Kore');
		expect(voice.tone).toContain('Buenos Aires');
		expect(voice.fillers).toContain('Vale.');
	});

	test('saved: an unknown voice is Kore, and the phrases as written', async () => {
		await setSatelliteVoice(k, null, {
			voice: 'Nadie',
			tone: ' Seria ',
			fillers: 'Ya va.\n\nYa va.'
		});
		expect(await satelliteVoiceOf(k)).toEqual({
			voice: 'Kore',
			tone: 'Seria',
			fillers: ['Ya va.']
		});
		await setSatelliteVoice(k, null, { voice: 'Leda', tone: '', fillers: 'Ya va.' });
		expect((await satelliteVoiceOf(k)).voice).toBe('Leda');
	});

	test('said in it, once for the same text', async () => {
		asked.length = 0;
		await satelliteSpeech(k, 'clave', 'Hola');
		await satelliteSpeech(k, 'clave', 'Hola');
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({ voice: 'Leda', input: 'Hola' });
	});

	test('a phrase not recorded yet is not said; recorded, at once', async () => {
		await setSatelliteVoice(k, null, { voice: 'Kore', tone: '', fillers: 'Un segundito.' });
		expect(await fillerSpeech(k, 'clave')).toBeNull();
		await warmFillers(k, 'clave');
		expect(await fillerSpeech(k, 'clave')).toBeInstanceOf(Uint8Array);
	});

	test('one at a time, and an answer before the phrases still waiting', async () => {
		await setSatelliteVoice(k, null, { voice: 'Kore', tone: '', fillers: 'Uno.\nDos.\nTres.' });
		asked.length = 0;
		mostInFlight = 0;
		const phrases = warmFillers(k, 'clave');
		const answer = satelliteSpeech(k, 'clave', 'Son las cuatro.');
		await Promise.all([phrases, answer]);
		expect(mostInFlight).toBe(1);
		expect(asked.map((r) => r.input)).toEqual(['Uno.', 'Son las cuatro.', 'Dos.', 'Tres.']);
	});

	test('the phrases kept in the family files: said from there after a restart', async () => {
		await setSatelliteVoice(k, null, { voice: 'Kore', tone: '', fillers: 'Ahí voy.' });
		await warmFillers(k, 'clave');
		expect([...files.keys()].filter((name) => name.startsWith('A/frases-espera/'))).toHaveLength(1);
		// The module again, with nothing in memory: as after a deploy.
		const restarted: typeof import('./satellite-voice.ts') = await import(
			`./satellite-voice.ts?${'reinicio'}`
		);
		asked.length = 0;
		expect(await restarted.fillerSpeech(k, 'clave')).toBeInstanceOf(Uint8Array);
		expect(asked).toHaveLength(0);
	});

	test('changing the phrases deletes the recordings of those gone', async () => {
		await setSatelliteVoice(k, null, { voice: 'Kore', tone: '', fillers: 'Ya casi.' });
		await warmFillers(k, 'clave');
		expect([...files.keys()].filter((name) => name.startsWith('A/frases-espera/'))).toHaveLength(1);
	});
});
