import { describe, expect, test } from 'bun:test';
import { playlistQueue } from './queue.ts';

const items = [
	{ id: 1, watched: true },
	{ id: 2, watched: false },
	{ id: 3, watched: true },
	{ id: 4, watched: false }
];

describe('playlistQueue', () => {
	test('without a choice: from the first not watched, skipping the watched ones after it', () => {
		expect(playlistQueue(items, null)).toEqual([2, 4]);
	});

	test('a chosen episode plays even if watched; the watched ones after it do not', () => {
		expect(playlistQueue(items, 1)).toEqual([1, 2, 4]);
		expect(playlistQueue(items, 3)).toEqual([3, 4]);
	});

	test('all watched: from the start, as the list shows it', () => {
		expect(playlistQueue([{ id: 7, watched: true }], null)).toEqual([7]);
	});

	test('empty', () => {
		expect(playlistQueue([], null)).toEqual([]);
	});
});
