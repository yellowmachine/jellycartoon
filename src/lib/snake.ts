/**
 * The snake, as on the Nokia 6110 (1997): the TV view's hidden game, opened with 6 1 1 0 on the
 * remote's number pad. Its rules, apart from how it is drawn: a grid, a snake growing with each
 * apple, and the end when it bites itself or a wall.
 */

export const COLS = 24;
export const ROWS = 14;

export type Cell = [number, number];
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Snake {
	/** Head first. */
	body: Cell[];
	direction: Direction;
	/** The direction asked for, taken at the next step: two quick turns do not reverse it. */
	next: Direction;
	food: Cell;
	score: number;
	over: boolean;
}

const MOVES: Record<Direction, Cell> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE: Record<Direction, Direction> = {
	up: 'down',
	down: 'up',
	left: 'right',
	right: 'left'
};

const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

/** An apple where the snake is not; `random` in [0, 1), Math.random in the game. */
export function placeFood(body: Cell[], random: () => number): Cell {
	const free: Cell[] = [];
	for (let y = 0; y < ROWS; y++)
		for (let x = 0; x < COLS; x++) if (!body.some((c) => same(c, [x, y]))) free.push([x, y]);
	return free[Math.floor(random() * free.length)] ?? [0, 0];
}

/** Three cells in the middle, going right. */
export function newSnake(random: () => number): Snake {
	const y = Math.floor(ROWS / 2);
	const body: Cell[] = [
		[6, y],
		[5, y],
		[4, y]
	];
	return {
		body,
		direction: 'right',
		next: 'right',
		food: placeFood(body, random),
		score: 0,
		over: false
	};
}

/** A turn, from the arrows; never straight back into itself. */
export function turn(snake: Snake, direction: Direction): Snake {
	return direction === OPPOSITE[snake.direction] ? snake : { ...snake, next: direction };
}

/** One step: forward, growing with an apple; over against a wall or itself. */
export function step(snake: Snake, random: () => number): Snake {
	if (snake.over) return snake;
	const direction = snake.next;
	const [dx, dy] = MOVES[direction];
	const head: Cell = [snake.body[0]![0] + dx, snake.body[0]![1] + dy];
	const eats = same(head, snake.food);
	// Its tail moves away this step, unless it grows: the head may go where the tail was.
	const rest = eats ? snake.body : snake.body.slice(0, -1);
	const outside = head[0] < 0 || head[1] < 0 || head[0] >= COLS || head[1] >= ROWS;
	if (outside || rest.some((c) => same(c, head))) return { ...snake, direction, over: true };
	const body = [head, ...rest];
	return {
		body,
		direction,
		next: direction,
		food: eats ? placeFood(body, random) : snake.food,
		score: snake.score + (eats ? 1 : 0),
		over: false
	};
}

/** Milliseconds a step: easy for the little ones at first, a bit quicker with each apple. */
export const stepMs = (score: number) => Math.max(80, 200 - score * 5);

/** The remote's number pad: these, in a row, open the game. */
export const CODE = '6110';
