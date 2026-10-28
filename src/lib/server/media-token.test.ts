import { describe, expect, test } from 'bun:test';
import { readGrant, signGrant, type MediaGrant } from './media-token.ts';

const key = Buffer.alloc(32, 1);
const grant: MediaGrant = { userId: 'u1', episodeId: 42, quality: 'light', expires: 2_000 };

describe('media grants', () => {
	test('read back as signed', () => {
		expect(readGrant(key, signGrant(key, grant), 1_000)).toEqual(grant);
	});

	test('not after they expire', () => {
		expect(readGrant(key, signGrant(key, grant), 2_001)).toBeNull();
	});

	test('not with another key', () => {
		expect(readGrant(Buffer.alloc(32, 2), signGrant(key, grant), 1_000)).toBeNull();
	});

	test('not with the payload changed', () => {
		const [, sig] = signGrant(key, grant).split('.');
		const other = Buffer.from(JSON.stringify(['u1', 43, 'light', 2_000])).toString('base64url');
		expect(readGrant(key, `${other}.${sig}`, 1_000)).toBeNull();
	});

	test('not malformed', () => {
		expect(readGrant(key, 'nada', 1_000)).toBeNull();
		expect(readGrant(key, `${signGrant(key, grant)}.más`, 1_000)).toBeNull();
	});

	test('safe in a path', () => {
		expect(signGrant(key, grant)).toMatch(/^[\w-]+\.[\w-]+$/);
	});
});
