import { describe, expect, test } from 'bun:test';
import { COLS, newSnake, placeFood, ROWS, step, stepMs, turn, type Snake } from './snake.ts';

const first = () => 0;
const at = (body: Snake['body'], food: Snake['food'], direction: Snake['direction'] = 'right') => ({
	body,
	direction,
	next: direction,
	food,
	score: 0,
	over: false
});

describe('step', () => {
	test('forward, the tail following', () => {
		const s = step(
			at(
				[
					[5, 5],
					[4, 5],
					[3, 5]
				],
				[0, 0]
			),
			first
		);
		expect(s.body).toEqual([
			[6, 5],
			[5, 5],
			[4, 5]
		]);
		expect(s.over).toBe(false);
	});

	test('an apple: it grows, a point, and another apple where it is not', () => {
		const s = step(
			at(
				[
					[5, 5],
					[4, 5]
				],
				[6, 5]
			),
			first
		);
		expect(s.body).toEqual([
			[6, 5],
			[5, 5],
			[4, 5]
		]);
		expect(s.score).toBe(1);
		expect(s.body.some((c) => c[0] === s.food[0] && c[1] === s.food[1])).toBe(false);
	});

	test('against a wall: over', () => {
		expect(
			step(
				at(
					[
						[COLS - 1, 0],
						[COLS - 2, 0]
					],
					[0, 5]
				),
				first
			).over
		).toBe(true);
		expect(
			step(
				at(
					[
						[3, 0],
						[3, 1]
					],
					[0, 5],
					'up'
				),
				first
			).over
		).toBe(true);
	});

	test('biting itself: over; where its tail was a moment ago, not', () => {
		// A square: going down, the head meets its own body.
		const loop = at(
			[
				[5, 5],
				[6, 5],
				[6, 6],
				[5, 6],
				[4, 6]
			],
			[0, 0],
			'down'
		);
		expect(step(loop, first).over).toBe(true);
		const chasing = at(
			[
				[5, 5],
				[6, 5],
				[6, 6],
				[5, 6]
			],
			[0, 0],
			'down'
		);
		expect(step(chasing, first).over).toBe(false);
	});
});

describe('turn', () => {
	test('taken at the next step, never straight back', () => {
		const s = at(
			[
				[5, 5],
				[4, 5]
			],
			[0, 0]
		);
		expect(turn(s, 'left').next).toBe('right');
		expect(step(turn(s, 'up'), first).body[0]).toEqual([5, 4]);
	});

	test('two quick turns before a step do not reverse it', () => {
		const s = turn(
			turn(
				at(
					[
						[5, 5],
						[4, 5]
					],
					[0, 0]
				),
				'up'
			),
			'left'
		);
		// «left» is checked against the way it goes (right), not the one asked for: refused.
		expect(s.next).toBe('up');
	});
});

test('a new game: three cells in the middle, the apple elsewhere', () => {
	const s = newSnake(first);
	expect(s.body).toHaveLength(3);
	expect(s.body[0]![1]).toBe(Math.floor(ROWS / 2));
	expect(placeFood(s.body, first)).toEqual([0, 0]);
});

test('quicker with each apple, not too quick', () => {
	expect(stepMs(0)).toBe(200);
	expect(stepMs(10)).toBe(150);
	expect(stepMs(100)).toBe(80);
});
