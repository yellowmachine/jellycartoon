import { describe, expect, test } from 'bun:test';
import { cleanNumber, isCallable, numberText, telHref } from './sim-number.ts';

describe('phone numbers', () => {
	test('cleaned for the phone app', () => {
		expect(cleanNumber('968 12 34 56')).toBe('968123456');
		expect(cleanNumber('+34 968-12-34-56')).toBe('+34968123456');
		expect(cleanNumber('0034 600 11 22 33')).toBe('+34600112233');
		expect(telHref('(968) 12.34.56')).toBe('tel:968123456');
	});
	test('callable: from 112 to 15 digits', () => {
		expect(isCallable('112')).toBe(true);
		expect(isCallable('016')).toBe(true);
		expect(isCallable('12')).toBe(false);
		expect(isCallable('una farmacia')).toBe(false);
		expect(isCallable('+34 1234567890123456')).toBe(false);
	});
	test('read in threes', () => {
		expect(numberText('968123456')).toBe('968 123 456');
		expect(numberText('+34968123456')).toBe('+34968123456');
	});
});
