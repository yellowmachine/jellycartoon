import { describe, expect, test } from 'bun:test';
import { seilideAccount } from './seilide-account.ts';

const NUBE = 'https://seilide.app';

describe('seilideAccount', () => {
	test('entered with Seilide: its account page, without a password here', () => {
		expect(seilideAccount(['nube'], NUBE, 'nube')).toEqual({
			url: 'https://seilide.app/ajustes?seccion=cuenta',
			ownPassword: false
		});
	});

	test('the administrator: also a password here', () => {
		expect(seilideAccount(['credential', 'nube'], NUBE, 'nube')?.ownPassword).toBe(true);
	});

	test('only a password here: nothing to say', () => {
		expect(seilideAccount(['credential'], NUBE, 'nube')).toBeNull();
	});

	test('a house without Seilide: nothing to say, whatever the account has', () => {
		expect(seilideAccount(['credential', 'nube'], null, 'nube')).toBeNull();
	});

	test('an address with a slash at the end', () => {
		expect(seilideAccount(['nube'], `${NUBE}/`, 'nube')?.url).toBe(
			'https://seilide.app/ajustes?seccion=cuenta'
		);
	});
});
