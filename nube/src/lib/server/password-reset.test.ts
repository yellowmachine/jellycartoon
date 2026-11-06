import { describe, expect, test } from 'bun:test';
import { KID_EMAIL_DOMAIN, mayMailReset } from './password-reset.ts';

describe('mayMailReset', () => {
	test('once every few minutes for each address, whatever its capitals', () => {
		expect(mayMailReset('una@ejemplo.es', 0)).toBe(true);
		expect(mayMailReset('UNA@ejemplo.es', 1000)).toBe(false);
		expect(mayMailReset('otra@ejemplo.es', 1000)).toBe(true);
		expect(mayMailReset('una@ejemplo.es', 5 * 60_000)).toBe(true);
	});

	test('never a child', () => {
		expect(mayMailReset(`peque-1@${KID_EMAIL_DOMAIN}`, 0)).toBe(false);
	});
});
