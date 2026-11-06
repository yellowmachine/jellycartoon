import { describe, expect, test } from 'bun:test';
import { parseSeilideKids, seilideAccount, usableDiscovery } from './seilide-account.ts';

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

describe('usableDiscovery', () => {
	const good = {
		issuer: `${NUBE}/api/auth`,
		authorization_endpoint: `${NUBE}/api/auth/oauth2/authorize`,
		token_endpoint: `${NUBE}/api/auth/oauth2/token`,
		jwks_uri: `${NUBE}/api/auth/jwks`
	};

	test('with all it needs', () => expect(usableDiscovery(good)).toBe(true));

	test('a page that answers something else does not count', () => {
		expect(usableDiscovery({ ...good, jwks_uri: undefined })).toBe(false);
		expect(usableDiscovery(null)).toBe(false);
		expect(usableDiscovery('<html>')).toBe(false);
	});
});

describe('parseSeilideKids', () => {
	test('as Seilide says them, with its address in small letters', () => {
		expect(
			parseSeilideKids([
				{ email: 'P-1@peques.invalid', name: ' Lucía ', avatar: 'zorro', guardians: ['a@t.es'] }
			])
		).toEqual([
			{ email: 'p-1@peques.invalid', name: 'Lucía', avatar: 'zorro', guardians: ['a@t.es'] }
		]);
	});

	test('someone with a real address is not a child of Seilide', () => {
		expect(parseSeilideKids([{ email: 'ana@t.es', name: 'Ana' }])).toEqual([]);
	});

	test('no drawing nor guardians, and something else than a list', () => {
		expect(parseSeilideKids([{ email: 'p@peques.invalid', name: '' }])).toEqual([
			{ email: 'p@peques.invalid', name: 'Peque', avatar: null, guardians: [] }
		]);
		expect(parseSeilideKids('nada')).toEqual([]);
	});
});
