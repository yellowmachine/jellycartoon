import { describe, expect, test } from 'bun:test';
import { askAfterLabel, longUnattended } from './still-there.ts';

describe('«¿Sigues ahí?» by time (#77)', () => {
	test('its labels', () => {
		expect(askAfterLabel(60)).toBe('1 h');
		expect(askAfterLabel(90)).toBe('1 h 30');
		expect(askAfterLabel(120)).toBe('2 h');
		expect(askAfterLabel(45)).toBe('45 min');
	});

	test('asks once that long has gone with nobody touching anything; never, never', () => {
		const touched = 1_000_000;
		expect(longUnattended(touched, 90, touched + 89 * 60_000)).toBe(false);
		expect(longUnattended(touched, 90, touched + 90 * 60_000)).toBe(true);
		expect(longUnattended(touched, null, touched + 600 * 60_000)).toBe(false);
	});
});
