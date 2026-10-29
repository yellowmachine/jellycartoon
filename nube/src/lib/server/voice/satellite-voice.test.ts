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
mock.module('#lib/server/openrouter.ts', () => ({
	speech: async (r: { voice: string; input: string; instructions?: string }) => {
		asked.push(r);
		return { pcm: new Uint8Array(4), rate: 24_000 };
	}
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
});
