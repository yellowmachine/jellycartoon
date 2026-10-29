import { describe, expect, test } from 'bun:test';
import { parseSnapserver } from './snapserver.ts';

describe('parseSnapserver', () => {
	test('an IP, a name, with or without port', () => {
		expect(parseSnapserver(' 192.168.68.56 ')).toBe('192.168.68.56');
		expect(parseSnapserver('Salon.local:1704')).toBe('salon.local:1704');
	});

	test('empty, none; anything else, not one', () => {
		expect(parseSnapserver('')).toBeNull();
		expect(parseSnapserver('no es; una ip')).toBeUndefined();
		expect(parseSnapserver('casa.local:99999')).toBeUndefined();
		expect(parseSnapserver('http://casa.local')).toBeUndefined();
	});
});
