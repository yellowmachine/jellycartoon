import { describe, expect, test } from 'bun:test';
import type { Guidance } from './road-guide.ts';
import { farMetres, nearMetres, spokenDistance, toSay } from './road-voice.ts';

const step = {
	instruction: 'Gira a la izquierda por Calle Real',
	distance: 0,
	at: [0, 0] as [number, number],
	index: 5,
	type: 0,
	duration: 30
};
const at = (toNext: number): Guidance => ({
	next: step,
	nextIndex: 2,
	toNext,
	remaining: 900,
	off: 0,
	arrived: false
});

test('spokenDistance: rounded as it is said', () => {
	expect(spokenDistance(312)).toBe('300 metros');
	expect(spokenDistance(20)).toBe('50 metros');
	expect(spokenDistance(1000)).toBe('1 kilómetro');
	expect(spokenDistance(1460)).toBe('1,5 kilómetros');
});

test('farther ahead the faster we go', () => {
	expect(farMetres(null)).toBe(250);
	expect(farMetres(33)).toBe(660); // ~120 km/h
	expect(nearMetres(10)).toBe(50);
});

describe('toSay', () => {
	test('too far yet: nothing', () => {
		expect(toSay(at(800), 10, new Set())).toBeNull();
	});

	test('well before: «En 300 metros, …», once', () => {
		expect(toSay(at(240), 10, new Set())).toEqual({
			key: 'far:2',
			text: 'En 250 metros, gira a la izquierda por Calle Real'
		});
		expect(toSay(at(200), 10, new Set(['far:2']))).toBeNull();
	});

	test('at it: the instruction alone, once', () => {
		const said = new Set(['far:2']);
		expect(toSay(at(40), 10, said)).toEqual({
			key: 'near:2',
			text: 'Gira a la izquierda por Calle Real'
		});
		expect(toSay(at(20), 10, new Set(['far:2', 'near:2']))).toBeNull();
	});

	test('a short step: straight to «at it», never «well before» after it', () => {
		expect(toSay(at(30), 10, new Set())?.key).toBe('near:2');
		expect(toSay(at(30), 10, new Set(['near:2']))).toBeNull();
	});

	test('arrived: once', () => {
		const arrived: Guidance = {
			next: null,
			nextIndex: -1,
			toNext: 0,
			remaining: 10,
			off: 0,
			arrived: true
		};
		expect(toSay(arrived, 0, new Set())).toEqual({
			key: 'arrived',
			text: 'Has llegado a tu destino'
		});
		expect(toSay(arrived, 0, new Set(['arrived']))).toBeNull();
	});

	test('straight on: not said', () => {
		const straight = { ...at(200), next: { ...step, type: 6, instruction: 'Sigue todo recto' } };
		expect(toSay(straight, 10, new Set())).toBeNull();
	});

	test('the arrival: said before it, not at it («Has llegado» is)', () => {
		const arrival = { ...step, type: 10, instruction: 'Llegas a Calle Real, de frente' };
		expect(toSay({ ...at(240), next: arrival }, 10, new Set())?.text).toBe(
			'En 250 metros, llegas a Calle Real, de frente'
		);
		expect(toSay({ ...at(20), next: arrival }, 10, new Set(['far:2']))).toBeNull();
	});
});
