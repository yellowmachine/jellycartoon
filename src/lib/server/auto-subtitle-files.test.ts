import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	formFile,
	isAutoFile,
	readCues,
	readPhrases,
	writeAutoSubtitles
} from './auto-subtitle-files.ts';

const dir = await mkdtemp(path.join(tmpdir(), 'subtitulos-test-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const phrases = [
	{ start: 1, end: 2, text: 'Has she slept at all?' },
	{ start: 2.4, end: 3, text: 'Nope.' },
	{ start: 3, end: 5, text: "No, it's been three nights in a row." }
];

test("Whisper's file, not a form's beside it nor an episode's own", () => {
	expect(isAutoFile('sub_auto_eng.vtt')).toBe(true);
	expect(isAutoFile('sub_auto_eng.rollup.vtt')).toBe(false);
	expect(isAutoFile('sub_auto_eng.json')).toBe(false);
	expect(isAutoFile('sub_0_eng.vtt')).toBe(false);
});

describe('made now: its phrases kept', () => {
	test('the phrases back as they were, and the .vtt in blocks', async () => {
		await writeAutoSubtitles(dir, 'sub_auto_eng.vtt', phrases);
		expect(await readPhrases(dir, 'sub_auto_eng.vtt')).toEqual(phrases);
		expect(await readFile(path.join(dir, 'sub_auto_eng.vtt'), 'utf8')).toContain(
			'Has she slept at all?\nNope.'
		);
	});

	test('for mpv: blocks is the file itself; another form, a file beside it', async () => {
		expect(await formFile(dir, 'sub_auto_eng.vtt', 'blocks')).toBe('sub_auto_eng.vtt');
		const name = await formFile(dir, 'sub_auto_eng.vtt', 'rollup');
		expect(name).toBe('sub_auto_eng.rollup.vtt');
		expect(await readFile(path.join(dir, name), 'utf8')).toContain('Nope.\nNo, it');
	});

	test("made again, a form's file is made again too", async () => {
		const beside = path.join(dir, 'sub_auto_eng.rollup.vtt');
		await utimes(beside, new Date(0), new Date(0));
		await writeAutoSubtitles(dir, 'sub_auto_eng.vtt', [{ start: 1, end: 2, text: 'Other.' }]);
		await formFile(dir, 'sub_auto_eng.vtt', 'rollup');
		expect(await readFile(beside, 'utf8')).toContain('Other.');
	});

	test('for Langua: the phrases, once each', async () => {
		await writeAutoSubtitles(dir, 'sub_auto_eng.vtt', phrases);
		expect((await readCues(dir, 'sub_auto_eng.vtt')).map((c) => c.text)).toEqual(
			phrases.map((p) => p.text)
		);
	});
});

test('made before the phrases were kept: back from the .vtt, rolled up', async () => {
	await writeFile(
		path.join(dir, 'sub_auto_spa.vtt'),
		'WEBVTT\n\n00:00:01.000 --> 00:00:02.400\nHola.\n\n00:00:02.400 --> 00:00:04.000\nHola.\n¿Qué tal?\n'
	);
	expect((await readPhrases(dir, 'sub_auto_spa.vtt')).map((c) => [c.start, c.text])).toEqual([
		[1, 'Hola.'],
		[2.4, '¿Qué tal?']
	]);
	// For mpv, even in blocks: a file made from them.
	expect(await formFile(dir, 'sub_auto_spa.vtt', 'blocks')).toBe('sub_auto_spa.blocks.vtt');
});
