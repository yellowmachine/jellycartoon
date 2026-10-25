import { describe, expect, test } from 'bun:test';
import { assign, controlsFor, isControls } from './game-controls.ts';

describe('controlsFor', () => {
	test("EmulatorJS' own without saved ones", () => {
		expect(controlsFor('nes')).toEqual({
			8: 'BUTTON_1',
			0: 'BUTTON_2',
			2: 'SELECT',
			3: 'START'
		});
	});

	test('the saved ones over them, and nothing unknown', () => {
		const controls = controlsFor('nes', { 8: 'BUTTON_3', 0: 'NOPE', 99: 'BUTTON_4' });
		expect(controls[8]).toBe('BUTTON_3');
		expect(controls[0]).toBe('BUTTON_2');
		expect(Object.keys(controls)).not.toContain('99');
	});

	test('a system without buttons here has none', () => {
		expect(controlsFor('n64')).toEqual({});
	});
});

describe('assign', () => {
	test("swaps with the gamepad's button that did it", () => {
		const next = assign(controlsFor('nes'), 'BUTTON_2', 8);
		expect(next[8]).toBe('BUTTON_2');
		expect(next[0]).toBe('BUTTON_1');
	});

	test('a free button of the gamepad takes it, and the old one is left free', () => {
		const next = assign(controlsFor('nes'), 'BUTTON_4', 8);
		expect(next[8]).toBe('BUTTON_4');
		expect(Object.values(next)).not.toContain('BUTTON_1');
	});
});

describe('isControls', () => {
	test("a console's whole controls", () => {
		expect(isControls('snes', controlsFor('snes'))).toBe(true);
	});

	test('not with a button twice, one missing, or an unknown one', () => {
		expect(isControls('nes', { ...controlsFor('nes'), 8: 'BUTTON_2' })).toBe(false);
		const { 8: _, ...missing } = controlsFor('nes');
		expect(isControls('nes', missing)).toBe(false);
		expect(isControls('nes', { ...controlsFor('nes'), 8: 'DPAD_UP' })).toBe(false);
		expect(isControls('nes', null)).toBe(false);
	});
});
