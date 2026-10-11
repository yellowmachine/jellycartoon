import { describe, expect, test } from 'bun:test';
import { titleBatches } from './episode-titles.ts';

const paths = (batches: { sourcePath: string }[][]) =>
	batches.map((b) => b.map((e) => e.sourcePath));

describe('titleBatches', () => {
	test('sorts by file name, numbers included', () => {
		const eps = ['s/B11_t10.mkv', 's/B2_t01.mkv', 's/B10_t09.mkv'].map((sourcePath) => ({
			sourcePath
		}));
		expect(paths(titleBatches(eps))).toEqual([['s/B2_t01.mkv', 's/B10_t09.mkv', 's/B11_t10.mkv']]);
	});

	test('keeps folders together when they fit', () => {
		const eps = [
			...['a1', 'a2', 'a3'].map((n) => ({ sourcePath: `Disc 1/${n}` })),
			...['b1', 'b2', 'b3'].map((n) => ({ sourcePath: `Disc 2/${n}` })),
			{ sourcePath: 'Disc 3/c1' }
		];
		expect(paths(titleBatches(eps, 4))).toEqual([
			['Disc 1/a1', 'Disc 1/a2', 'Disc 1/a3'],
			['Disc 2/b1', 'Disc 2/b2', 'Disc 2/b3', 'Disc 3/c1']
		]);
	});

	test('splits a folder bigger than a batch', () => {
		const eps = Array.from({ length: 5 }, (_, i) => ({ sourcePath: `yt/${i + 1}.webm` }));
		expect(titleBatches(eps, 2).map((b) => b.length)).toEqual([2, 2, 1]);
	});
});
