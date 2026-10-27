import { expect, test } from 'bun:test';
import { swapPlaces } from './queue-order.ts';

const ALL = [
	{ id: 1, queueOrder: 0 },
	{ id: 2, queueOrder: 1 },
	{ id: 3, queueOrder: 2 },
	{ id: 4, queueOrder: null }
];

test('two series swap their places; the one between keeps its own', () => {
	expect(swapPlaces(ALL, [3, 1])).toEqual([
		{ id: 3, queueOrder: 0 },
		{ id: 2, queueOrder: 1 },
		{ id: 1, queueOrder: 2 }
	]);
});

test('one without order that is moved gets one; the others without stay without', () => {
	expect(swapPlaces([...ALL, { id: 5, queueOrder: null }], [5, 2])).toEqual([
		{ id: 1, queueOrder: 0 },
		{ id: 5, queueOrder: 1 },
		{ id: 3, queueOrder: 2 },
		{ id: 2, queueOrder: 4 }
	]);
});

test('a series that no longer exists is left out', () => {
	expect(swapPlaces(ALL, [9, 2, 1])).toEqual([
		{ id: 2, queueOrder: 0 },
		{ id: 1, queueOrder: 1 },
		{ id: 3, queueOrder: 2 }
	]);
});
