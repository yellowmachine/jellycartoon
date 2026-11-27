import { describe, expect, test } from 'bun:test';
import { satellitePage, satellitePageSaid } from './satellite-live.ts';

describe('its page of devices, from its beat (#643)', () => {
	test('kept as it says, if it is the home network’s', () => {
		satellitePageSaid('s1', 'http://192.168.68.61:8790/alta');
		expect(satellitePage('s1')).toBe('http://192.168.68.61:8790/alta');
	});
	test('anything else, never linked', () => {
		for (const url of [
			'https://evil.example/alta',
			'http://192.168.68.61:8790/alta?x=1',
			'javascript:alert(1)',
			42,
			undefined
		])
			satellitePageSaid('s2', url);
		expect(satellitePage('s2')).toBeNull();
	});
});
