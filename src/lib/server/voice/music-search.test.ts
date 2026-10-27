import { describe, expect, test } from 'bun:test';
import type { MusicAlbum } from '#lib/music.ts';
import { likeness, searchMusic } from './music-search.ts';

function album(id: number, title: string, artist: string, songs: string[]): MusicAlbum {
	return {
		id,
		title,
		artist,
		hasCover: false,
		tracks: songs.map((song, i) => ({
			id: id * 100 + i,
			title: song,
			artist,
			number: i + 1,
			durationSec: null,
			albumId: id,
			album: title,
			hasCover: false
		}))
	};
}

const albums = [
	album(1, 'A Night at the Opera', 'Queen', ['Bohemian Rhapsody', 'Love of My Life']),
	album(2, 'The Works', 'Queen', ['Radio Ga Ga']),
	album(3, 'The Wall', 'Pink Floyd', ['Comfortably Numb']),
	album(4, 'Deseo carnal', 'Alaska y Dinarama', ['Ni tú ni nadie'])
];
const titles = (result: string) =>
	JSON.parse(result.slice(result.indexOf('{'))).tracks.map((t: { title: string }) => t.title);

describe('searchMusic', () => {
	test('every word as it is, as before', () => {
		const found = searchMusic('rhapsody', albums, []);
		expect(found.startsWith('{')).toBe(true);
		expect(titles(found)).toEqual(['Bohemian Rhapsody']);
	});

	test('a name heard wrong, by how it sounds', () => {
		const found = searchMusic('Boyman Rhapsody The Queen', albums, []);
		expect(found).toStartWith('Nada con «Boyman Rhapsody The Queen» tal cual');
		expect(titles(found)).toEqual(['Bohemian Rhapsody']);
	});

	test('an artist misspelt', () => {
		const found = searchMusic('pink flyod', albums, []);
		expect(JSON.parse(found.slice(found.indexOf('{'))).artists).toEqual(['Pink Floyd']);
	});

	test('nothing alike', () => {
		expect(searchMusic('zarzuela del barberillo', albums, [])).toBe(
			'Nada con «zarzuela del barberillo». Prueba con otras palabras.'
		);
	});
});

test('likeness: each word asked against the most alike of the name', () => {
	expect(likeness(['rhapsody'], 'Bohemian Rhapsody Queen')).toBe(1);
	expect(likeness(['boyman', 'rhapsody'], 'Bohemian Rhapsody Queen')).toBeGreaterThan(0.75);
	expect(likeness(['boyman', 'rhapsody'], 'Radio Ga Ga Queen')).toBeLessThan(0.5);
});
