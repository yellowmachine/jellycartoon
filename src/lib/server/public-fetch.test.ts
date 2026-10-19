import { expect, test } from 'bun:test';
import { fetchPublic, isPublicAddress } from './public-fetch.ts';

test('isPublicAddress: the internet, not the house nor the server', () => {
	for (const ip of ['8.8.8.8', '151.101.1.69', '2a00:1450:4003:80e::200e'])
		expect(isPublicAddress(ip)).toBe(true);
	for (const ip of [
		'127.0.0.1',
		'10.0.0.5',
		'172.18.0.3',
		'192.168.1.20',
		'100.101.102.103',
		'169.254.169.254',
		'0.0.0.0',
		'::1',
		'fd7a:115c:a1e0::1',
		'fe80::1',
		'::ffff:192.168.1.1',
		'no es una ip'
	])
		expect(isPublicAddress(ip)).toBe(false);
});

test('fetchPublic: no local addresses, nor other protocols', async () => {
	const get = (url: string) => fetchPublic(url, { maxBytes: 1000, timeoutMs: 2000 });
	await expect(get('http://127.0.0.1:3000/')).rejects.toThrow('no es de internet');
	await expect(get('http://localhost/')).rejects.toThrow('no es de internet');
	await expect(get('http://[::1]/')).rejects.toThrow('no es de internet');
	await expect(get('http://192.168.1.1/admin')).rejects.toThrow('no es de internet');
	await expect(get('file:///etc/passwd')).rejects.toThrow('http:// o https://');
	await expect(get('https://user:pw@example.com/')).rejects.toThrow('usuario');
	await expect(get('receta de macarrones')).rejects.toThrow('no es una dirección web');
});
