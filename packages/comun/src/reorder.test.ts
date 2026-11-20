import { describe, expect, it } from 'bun:test';
import { moveBefore, moveOf } from './reorder.ts';

describe('moveBefore', () => {
	it('moves up, down and to the end', () => {
		expect(moveBefore([1, 2, 3, 4], 4, 1)).toEqual([4, 1, 2, 3]);
		expect(moveBefore([1, 2, 3, 4], 1, 4)).toEqual([2, 3, 1, 4]);
		expect(moveBefore([1, 2, 3, 4], 2, null)).toEqual([1, 3, 4, 2]);
	});

	it('leaves the list as it is for itself or an unknown id', () => {
		expect(moveBefore([1, 2, 3], 2, 2)).toEqual([1, 2, 3]);
		expect(moveBefore([1, 2, 3], 9, 1)).toEqual([1, 2, 3]);
	});

	it('goes to the end when the one before is gone', () => {
		expect(moveBefore([1, 2, 3], 1, 9)).toEqual([2, 3, 1]);
	});
});

describe('moveOf', () => {
	const form = (entries: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(entries)) f.set(k, v);
		return f;
	};

	it('reads the item and the one before, or the end', () => {
		expect(moveOf(form({ itemId: '5', beforeId: '7' }))).toEqual({ itemId: 5, beforeId: 7 });
		expect(moveOf(form({ itemId: '5', beforeId: '' }))).toEqual({ itemId: 5, beforeId: null });
		expect(moveOf(form({ itemId: '5' }))).toEqual({ itemId: 5, beforeId: null });
	});

	it('refuses what is not an id', () => {
		expect(moveOf(form({ itemId: 'x' }))).toBeNull();
		expect(moveOf(form({ itemId: '5', beforeId: 'y' }))).toBeNull();
	});
});
