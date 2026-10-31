import { expect, test } from 'bun:test';
import { readPrayerPass, signPrayerPass } from './prayer-pass.ts';

/** Oración's pass (#339): the family's, until it expires, and only with Seilide's key. */
const key = Buffer.alloc(32, 1);
const pass = { familyId: 'A', expires: Date.now() + 60_000 };

test('read back as it was signed, safe in a path', () => {
	const token = signPrayerPass(key, pass);
	expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
	expect(readPrayerPass(key, token)).toEqual(pass);
});

test('not with another key, changed, expired or malformed', () => {
	const token = signPrayerPass(key, pass);
	expect(readPrayerPass(Buffer.alloc(32, 2), token)).toBeNull();
	const [payload, sig] = token.split('.');
	const other = Buffer.from(JSON.stringify(['oracion', 'B', pass.expires])).toString('base64url');
	expect(readPrayerPass(key, `${other}.${sig}`)).toBeNull();
	expect(readPrayerPass(key, token, pass.expires + 1)).toBeNull();
	expect(readPrayerPass(key, `${payload}.${sig}.x`)).toBeNull();
	expect(readPrayerPass(key, 'nada')).toBeNull();
});
