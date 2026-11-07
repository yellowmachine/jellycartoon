import { describe, expect, test } from 'bun:test';
import { hearingKey, validHearingKey } from './hearing-key.ts';

describe('the key to the house’s Whisper alone', () => {
	const key = hearingKey('secreto', 'a4eddb2f');

	test('good with the secret that signed it', () => {
		expect(validHearingKey('secreto', key)).toBe(true);
	});

	test('not with another secret, another satellite or a changed signature', () => {
		expect(validHearingKey('otro', key)).toBe(false);
		expect(validHearingKey('secreto', `b${key}`)).toBe(false);
		expect(validHearingKey('secreto', `${key}x`)).toBe(false);
	});

	test('nothing, or no signature, is no key', () => {
		for (const bad of [null, '', 'a4eddb2f', '.', '.firma', 'a4eddb2f.'])
			expect(validHearingKey('secreto', bad)).toBe(false);
	});
});
