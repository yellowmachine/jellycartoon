import { expect, test } from 'bun:test';
import { MAX_OFFLINE_BYTES, estimatedBytes } from './offline-music.ts';

test('a list of an hour in Opus, some 72 MB', () => {
	expect(estimatedBytes([3600])).toBe(72_000_000);
});

test('the lists a device carries are added up', () => {
	expect(estimatedBytes([1800, 1800])).toBe(estimatedBytes([3600]));
	expect(estimatedBytes([])).toBe(0);
});

test('2 GB is some 500 songs of three minutes and a half', () => {
	const songs = Math.floor(MAX_OFFLINE_BYTES / estimatedBytes([210]));
	expect(songs).toBeGreaterThan(450);
	expect(songs).toBeLessThan(500);
});
