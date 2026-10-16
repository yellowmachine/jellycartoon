import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, mock, test } from 'bun:test';

mock.module('$app/env/private', () => ({ APP_VERSION: '1.2.0' }));
mock.module('#lib/server/db/index.ts', () => ({ db: {} }));
const { passwordMatches, plainPassword } = await import('./protocol.ts');
const { artistKey, buildLibrary, indexLetter, matches, parseId } = await import('./library.ts');

describe('passwordMatches', () => {
	// A new one each run, as Ajustes makes them: none is written here.
	const password = randomBytes(12).toString('hex');
	const md5 = (text: string) => createHash('md5').update(text).digest('hex');

	test('token and salt: md5(password + salt), as the apps send it', () => {
		expect(passwordMatches(password, { t: md5(password + 'x7y'), s: 'x7y' })).toBe(true);
		expect(passwordMatches(password, { t: md5(password + 'x7y').toUpperCase(), s: 'x7y' })).toBe(
			true
		);
		expect(passwordMatches(password, { t: md5('otra' + 'x7y'), s: 'x7y' })).toBe(false);
		expect(passwordMatches(password, { t: md5(password + 'x7y'), s: 'otra' })).toBe(false);
	});

	test('the password itself, plain or hex after enc:', () => {
		expect(passwordMatches(password, { p: password })).toBe(true);
		expect(passwordMatches(password, { p: `enc:${Buffer.from(password).toString('hex')}` })).toBe(
			true
		);
		expect(passwordMatches(password, { p: 'otra' })).toBe(false);
	});

	test('without anything, no', () => {
		expect(passwordMatches(password, {})).toBe(false);
		expect(plainPassword('enc:686f6c61')).toBe('hola');
	});
});

describe('ids', () => {
	test('an artist, with accents and symbols, comes back as it was', () => {
		for (const name of ['Beyoncé', 'AC/DC', 'Simon & Garfunkel', 'Varios artistas'])
			expect(parseId(artistKey(name))).toEqual({ kind: 'artist', name });
	});

	test('albums and tracks; anything else, nothing', () => {
		expect(parseId('al-187')).toEqual({ kind: 'album', id: 187 });
		expect(parseId('tr-5021')).toEqual({ kind: 'track', id: 5021 });
		expect(parseId('187')).toBeNull();
		expect(parseId('al-x')).toBeNull();
		expect(parseId(null)).toBeNull();
	});

	test('the index of an artist: its first letter without accents, or #', () => {
		expect(indexLetter('Álvaro Soler')).toBe('A');
		expect(indexLetter('the Doors')).toBe('T');
		expect(indexLetter('2Pac')).toBe('#');
	});
});

test('buildLibrary: albums with their tracks, artists by name without accents nor case', () => {
	const row = (id: number, albumId: number, albumArtist: string, mtime: string) => ({
		id,
		albumId,
		title: `Pista ${id}`,
		artist: albumArtist,
		number: id,
		durationSec: 200,
		size: 1000,
		path: `${albumId}/${id}.flac`,
		mtime: new Date(mtime),
		albumTitle: `Álbum ${albumId}`,
		albumArtist,
		hasCover: true
	});
	const library = buildLibrary([
		row(1, 10, 'Beyoncé', '2024-01-01'),
		row(2, 10, 'Beyoncé', '2025-06-01'),
		row(3, 11, 'beyonce', '2023-01-01')
	]);
	expect(library.albums.get(10)!.tracks.map((t) => t.id)).toEqual([1, 2]);
	// An album is as new as its newest file.
	expect(library.albums.get(10)!.created.toISOString().slice(0, 10)).toBe('2025-06-01');
	expect(library.artists.size).toBe(1);
	expect([...library.artists.values()][0].albums.map((a) => a.id)).toEqual([10, 11]);
});

test('matches: every word, without accents nor case', () => {
	expect(matches('Ghost in the Shell: Stand Alone Complex', 'ghost complex')).toBe(true);
	expect(matches('Canción de Amor', 'cancion amor')).toBe(true);
	expect(matches('Ghost in the Shell', 'ghost robot')).toBe(false);
});
