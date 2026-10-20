import { describe, expect, test } from 'bun:test';
import { allowedWhileSettingUp, mustSetUp } from './two-factor.ts';

describe('mustSetUp', () => {
	test('only a session marked at sign-in, while its account has no second step', () => {
		expect(mustSetUp({ twoFactorSetup: true }, { twoFactorEnabled: false })).toBe(true);
		expect(mustSetUp({ twoFactorSetup: true }, { twoFactorEnabled: null })).toBe(true);
	});

	test('done: the same session goes on as usual', () => {
		expect(mustSetUp({ twoFactorSetup: true }, { twoFactorEnabled: true })).toBe(false);
	});

	test('sessions opened before (the living room TV) are left as they were', () => {
		expect(mustSetUp({ twoFactorSetup: false }, { twoFactorEnabled: false })).toBe(false);
		expect(mustSetUp({}, { twoFactorEnabled: false })).toBe(false);
		expect(mustSetUp(undefined, undefined)).toBe(false);
	});
});

describe('allowedWhileSettingUp', () => {
	test('the page to set it up, leaving, and what Better Auth needs for it', () => {
		for (const path of ['/verificacion', '/logout', '/api/auth/two-factor/enable', '/api/health'])
			expect(allowedWhileSettingUp(path)).toBe(true);
	});

	test('nothing else, not even what only starts the same', () => {
		for (const path of ['/', '/ajustes', '/api/hls/1/master.m3u8', '/verificacionx', '/logouts'])
			expect(allowedWhileSettingUp(path)).toBe(false);
	});
});
