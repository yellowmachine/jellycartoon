import { describe, expect, test } from 'bun:test';
import { chapterTitle, sceneFrameAt, sceneNames } from './scenes.ts';

describe('chapterTitle', () => {
	test('drops the generic names', () => {
		for (const title of ['Chapter 01', 'Capítulo 3', 'chapitre_12', '00:05:00.000', '7', '', ' '])
			expect(chapterTitle(title)).toBeNull();
		expect(chapterTitle(undefined)).toBeNull();
	});

	test('keeps the real ones', () => {
		expect(chapterTitle(' La llegada ')).toBe('La llegada');
		expect(chapterTitle('Chapter 1: The Heist')).toBe('Chapter 1: The Heist');
	});
});

describe('sceneFrameAt', () => {
	const chapters = [0, 258.3, 260, 391.7].map((startSec) => ({ startSec, title: null }));

	test('is a little after the start', () => {
		expect(sceneFrameAt(chapters, 0, 6000)).toBe(3);
		expect(sceneFrameAt(chapters, 3, 6000)).toBe(394);
	});

	test('stays inside a short chapter', () => {
		expect(sceneFrameAt(chapters, 1, 6000)).toBe(259);
	});

	test('uses the end of the film for the last one', () => {
		expect(sceneFrameAt(chapters, 3, 393)).toBe(392);
	});
});

describe('sceneNames', () => {
	const chapters = [
		{ startSec: 0, title: null },
		{ startSec: 258.299708, title: null },
		{ startSec: 391.68, title: 'Del disco' }
	];

	test('matches the names by start, and the file’s own name wins', () => {
		expect(
			sceneNames(chapters, [
				{ startSec: 258.299708, name: 'El parque' },
				{ startSec: 391.68, name: 'De la IA' }
			])
		).toEqual([null, 'El parque', 'Del disco']);
	});

	test('works without names', () => {
		expect(sceneNames(chapters, null)).toEqual([null, null, 'Del disco']);
	});
});
