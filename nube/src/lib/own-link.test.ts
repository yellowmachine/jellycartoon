import { describe, expect, test } from 'bun:test';
import { ownPath } from './own-link.ts';

const origin = 'https://seilide.app';

describe('ownPath', () => {
	test('a Seilide link opens its page', () => {
		expect(ownPath('https://seilide.app/vincular/abc123', origin)).toBe('/vincular/abc123');
		expect(ownPath('https://seilide.app/p/x?y=1#z', origin)).toBe('/p/x?y=1#z');
	});
	test('another site, or another port or scheme, is not ours', () => {
		expect(ownPath('https://www.recetas.example/tarta', origin)).toBeNull();
		expect(ownPath('https://seilide.app.evil.example/vincular/a', origin)).toBeNull();
		expect(ownPath('http://seilide.app/vincular/a', origin)).toBeNull();
		expect(ownPath('https://seilide.app:8443/vincular/a', origin)).toBeNull();
	});
	test('not a link', () => {
		expect(ownPath('hola', origin)).toBeNull();
	});
});
