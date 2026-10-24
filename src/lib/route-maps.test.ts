import { describe, expect, test } from 'bun:test';
import { isDeviceId, sizeText } from './route-maps.ts';

describe('route maps (#164)', () => {
	test('sizes as people read them', () => {
		expect(sizeText(22_265_986)).toBe('22 MB');
		expect(sizeText(300_000)).toBe('1 MB');
		expect(sizeText(1_234_000_000)).toBe('1,2 GB');
	});

	test('a device id is the one it makes', () => {
		expect(isDeviceId(crypto.randomUUID())).toBe(true);
		expect(isDeviceId('../../etc')).toBe(false);
		expect(isDeviceId(12)).toBe(false);
	});
});
